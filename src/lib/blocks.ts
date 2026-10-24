import { marked, type Token, type Tokens } from "marked";

/**
 * Notes are stored as BlockNote JSON. These helpers convert between that
 * JSON, Markdown (what Claude writes and what exports use) and plain text
 * (what search and Claude read). They run on the server and in the browser.
 */

export type InlineText = { type: "text"; text: string; styles?: Record<string, boolean | string> };
export type InlineLink = { type: "link"; href: string; content: InlineText[] };
export type InlineMention = { type: "mention"; props: { kind: string; id: string; title: string } };
export type Inline = InlineText | InlineLink | InlineMention | { type: string; [k: string]: unknown };

export type Block = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: Inline[] | string | TableContent | undefined;
  children?: Block[];
};

type TableContent = { type: "tableContent"; columnWidths?: (number | undefined)[]; headerRows?: number; rows: { cells: (Inline[] | { type: "tableCell"; content: Inline[] })[] }[] };

/* ------------------------------ Markdown → blocks ------------------------------ */

function inlineFrom(tokens: Token[] | undefined, styles: Record<string, boolean> = {}): Inline[] {
  const out: Inline[] = [];
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case "text": {
        const t = tok as Tokens.Text;
        if (t.tokens?.length) out.push(...inlineFrom(t.tokens, styles));
        else out.push({ type: "text", text: decode(t.text), styles: { ...styles } });
        break;
      }
      case "strong":
        out.push(...inlineFrom((tok as Tokens.Strong).tokens, { ...styles, bold: true }));
        break;
      case "em":
        out.push(...inlineFrom((tok as Tokens.Em).tokens, { ...styles, italic: true }));
        break;
      case "del":
        out.push(...inlineFrom((tok as Tokens.Del).tokens, { ...styles, strike: true }));
        break;
      case "codespan":
        out.push({ type: "text", text: decode((tok as Tokens.Codespan).text), styles: { ...styles, code: true } });
        break;
      case "link": {
        const l = tok as Tokens.Link;
        const mention = /^app:\/\/(\w+)\/([0-9a-f-]{36})$/i.exec(l.href);
        if (mention) {
          out.push({ type: "mention", props: { kind: mention[1]!, id: mention[2]!, title: l.text } });
        } else {
          out.push({ type: "link", href: l.href, content: inlineFrom(l.tokens, styles).filter((x): x is InlineText => x.type === "text") });
        }
        break;
      }
      case "br":
        out.push({ type: "text", text: "\n", styles: { ...styles } });
        break;
      case "escape":
        out.push({ type: "text", text: (tok as Tokens.Escape).text, styles: { ...styles } });
        break;
      case "html":
        out.push({ type: "text", text: (tok as Tokens.HTML).text.replace(/<[^>]+>/g, ""), styles: { ...styles } });
        break;
      default:
        if ("text" in tok && typeof tok.text === "string") out.push({ type: "text", text: decode(tok.text), styles: { ...styles } });
    }
  }
  return merge(out);
}

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Join neighbouring text runs that share styles. */
function merge(list: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const item of list) {
    const prev = out[out.length - 1];
    if (prev && prev.type === "text" && item.type === "text" && JSON.stringify((prev as InlineText).styles ?? {}) === JSON.stringify((item as InlineText).styles ?? {})) {
      (prev as InlineText).text += (item as InlineText).text;
    } else out.push(item);
  }
  return out;
}

function listItems(list: Tokens.List): Block[] {
  return list.items.map((item) => {
    const inner = item.tokens ?? [];
    const textTokens = inner.filter((t) => t.type !== "list");
    const nested = inner.filter((t): t is Tokens.List => t.type === "list");
    let content = inlineFrom(textTokens.flatMap((t) => ("tokens" in t && t.tokens ? (t.tokens as Token[]) : [t])));
    // An empty "- [ ] " is not a task item for marked; templates use it as an empty checkbox.
    const bare = item.task ? null : /^\[( |x|X)\]\s*$/.exec(item.text ?? "");
    if (bare) content = [];
    const task = item.task || Boolean(bare);
    const type = task ? "checkListItem" : list.ordered ? "numberedListItem" : "bulletListItem";
    return {
      type,
      props: task ? { checked: item.task ? Boolean(item.checked) : bare?.[1] !== " " } : {},
      content,
      children: nested.flatMap(listItems),
    };
  });
}

export function markdownToBlocks(md: string): Block[] {
  const tokens = marked.lexer(md ?? "", { gfm: true });
  const out: Block[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case "heading": {
        const h = tok as Tokens.Heading;
        out.push({ type: "heading", props: { level: Math.min(3, Math.max(1, h.depth)) }, content: inlineFrom(h.tokens) });
        break;
      }
      case "paragraph":
        out.push({ type: "paragraph", content: inlineFrom((tok as Tokens.Paragraph).tokens) });
        break;
      case "list":
        out.push(...listItems(tok as Tokens.List));
        break;
      case "blockquote": {
        const q = tok as Tokens.Blockquote;
        const inner = (q.tokens ?? []).flatMap((t) => ("tokens" in t && t.tokens ? [...(t.tokens as Token[]), { type: "br", raw: "\n" } as Token] : [t]));
        const content = inlineFrom(inner);
        // Drop the trailing line break.
        const last = content[content.length - 1];
        if (last?.type === "text") (last as InlineText).text = (last as InlineText).text.replace(/\n+$/, "");
        out.push({ type: "quote", content });
        break;
      }
      case "code": {
        const c = tok as Tokens.Code;
        out.push({ type: "codeBlock", props: { language: c.lang || "text" }, content: c.text });
        break;
      }
      case "table": {
        const tb = tok as Tokens.Table;
        const rows = [tb.header, ...tb.rows].map((row) => ({
          cells: row.map((cell) => ({ type: "tableCell" as const, content: inlineFrom(cell.tokens) })),
        }));
        out.push({ type: "table", content: { type: "tableContent", columnWidths: tb.header.map(() => undefined), headerRows: 1, rows } });
        break;
      }
      case "hr":
        out.push({ type: "divider" });
        break;
      case "space":
        break;
      case "html":
        out.push({ type: "paragraph", content: [{ type: "text", text: (tok as Tokens.HTML).text.replace(/<[^>]+>/g, "").trim() }] });
        break;
      default:
        if ("text" in tok && typeof tok.text === "string" && tok.text.trim()) out.push({ type: "paragraph", content: [{ type: "text", text: tok.text }] });
    }
  }
  return out;
}

/** Plain text lines into paragraph blocks (quick notes, pasted text). */
export function textToBlocks(text: string): Block[] {
  return text
    .split(/\r?\n/)
    .map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line } as InlineText] : [] }));
}

/* ------------------------------ Blocks → text ------------------------------ */

export function inlineToText(content: Block["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    const table = content as TableContent;
    return (table.rows ?? [])
      .map((r) => r.cells.map((c) => inlineToText(Array.isArray(c) ? c : c.content)).join(" | "))
      .join("\n");
  }
  return content
    .map((c) => {
      if (c.type === "text") return (c as InlineText).text;
      if (c.type === "link") return (c as InlineLink).content.map((x) => x.text).join("");
      if (c.type === "mention") return (c as InlineMention).props.title;
      return typeof (c as { text?: unknown }).text === "string" ? String((c as { text: string }).text) : "";
    })
    .join("");
}

export function blocksToPlainText(blocks: Block[] | null | undefined, depth = 0): string {
  const lines: string[] = [];
  for (const b of blocks ?? []) {
    const text = inlineToText(b.content);
    const pad = "  ".repeat(depth);
    if (b.type === "task" && b.props?.title) lines.push(`${pad}[${b.props?.done ? "x" : " "}] ${String(b.props.title)}`);
    else if (b.type === "entityCard" && b.props?.title) lines.push(`${pad}${String(b.props.title)}`);
    else if (b.type === "checkListItem") lines.push(`${pad}[${b.props?.checked ? "x" : " "}] ${text}`);
    else if (b.type === "bulletListItem" || b.type === "numberedListItem" || b.type === "toggleListItem") lines.push(`${pad}- ${text}`);
    else if (b.type === "callout") lines.push(`${pad}${text}`);
    else if (text) lines.push(pad + text);
    if (b.children?.length) lines.push(blocksToPlainText(b.children, depth + 1));
  }
  return lines.filter((l) => l !== "").join("\n");
}

function inlineToMarkdown(content: Block["content"]): string {
  if (!content || typeof content === "string" || !Array.isArray(content)) return inlineToText(content);
  return content
    .map((c) => {
      if (c.type === "text") {
        const t = c as InlineText;
        let s = t.text;
        if (!s) return "";
        const st = t.styles ?? {};
        if (st.code) return "`" + s + "`";
        if (st.bold) s = `**${s}**`;
        if (st.italic) s = `*${s}*`;
        if (st.strike) s = `~~${s}~~`;
        return s;
      }
      if (c.type === "link") {
        const l = c as InlineLink;
        return `[${l.content.map((x) => x.text).join("")}](${l.href})`;
      }
      if (c.type === "mention") {
        const m = c as InlineMention;
        return `[${m.props.title}](app://${m.props.kind}/${m.props.id})`;
      }
      return "";
    })
    .join("");
}

export function blocksToMarkdown(blocks: Block[] | null | undefined, depth = 0): string {
  const out: string[] = [];
  let n = 0;
  for (const b of blocks ?? []) {
    const pad = "  ".repeat(depth);
    const text = inlineToMarkdown(b.content);
    n = b.type === "numberedListItem" ? n + 1 : 0;
    switch (b.type) {
      case "heading":
        out.push(`${"#".repeat(Number(b.props?.level ?? 1))} ${text}`, "");
        break;
      case "bulletListItem":
      case "toggleListItem":
        out.push(`${pad}- ${text}`);
        break;
      case "numberedListItem":
        out.push(`${pad}${n}. ${text}`);
        break;
      case "checkListItem":
        out.push(`${pad}- [${b.props?.checked ? "x" : " "}] ${text}`);
        break;
      case "quote":
        out.push(text.split("\n").map((l) => `> ${l}`).join("\n"), "");
        break;
      case "callout":
        out.push(`> ${b.props?.emoji ?? "💡"} ${text}`, "");
        break;
      case "codeBlock":
        out.push("```" + String(b.props?.language ?? ""), typeof b.content === "string" ? b.content : inlineToText(b.content), "```", "");
        break;
      case "divider":
        out.push("---", "");
        break;
      case "table": {
        const tc = b.content as TableContent | undefined;
        const rows = (tc?.rows ?? []).map((r) => r.cells.map((c) => inlineToMarkdown(Array.isArray(c) ? c : c.content).replace(/\|/g, "\\|")));
        if (rows.length) {
          out.push(`| ${rows[0]!.join(" | ")} |`, `| ${rows[0]!.map(() => "---").join(" | ")} |`);
          for (const r of rows.slice(1)) out.push(`| ${r.join(" | ")} |`);
          out.push("");
        }
        break;
      }
      case "image":
        out.push(`![${String(b.props?.caption ?? "")}](${String(b.props?.url ?? "")})`, "");
        break;
      case "task":
        if (b.props?.title) out.push(`${pad}- [${b.props?.done ? "x" : " "}] ${b.props?.taskId ? `[${String(b.props.title)}](app://task/${String(b.props.taskId)})` : String(b.props.title)}`);
        break;
      case "entityCard":
        if (b.props?.id) out.push(`${pad}[${String(b.props?.title ?? "")}](app://${String(b.props?.kind)}/${String(b.props?.id)})`, "");
        break;
      default:
        out.push(pad + text, depth ? "" : "");
    }
    if (b.children?.length) out.push(blocksToMarkdown(b.children, depth + 1));
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every record @mentioned in a page, for backlinks. */
export function extractMentions(blocks: Block[] | null | undefined): { kind: string; id: string; title: string }[] {
  const found = new Map<string, { kind: string; id: string; title: string }>();
  const walk = (list: Block[] | undefined) => {
    for (const b of list ?? []) {
      const content = b.content;
      const runs: Inline[] = Array.isArray(content)
        ? content
        : content && typeof content === "object"
          ? (content as TableContent).rows.flatMap((r) => r.cells.flatMap((c) => (Array.isArray(c) ? c : c.content)))
          : [];
      for (const c of runs) {
        if (c.type === "mention") {
          const m = c as InlineMention;
          found.set(`${m.props.kind}:${m.props.id}`, m.props);
        }
      }
      // Task blocks and record cards link the page too, so they show as backlinks.
      if (b.type === "task" && b.props?.taskId) found.set(`task:${String(b.props.taskId)}`, { kind: "task", id: String(b.props.taskId), title: String(b.props.title ?? "") });
      if (b.type === "entityCard" && b.props?.id) found.set(`${String(b.props.kind)}:${String(b.props.id)}`, { kind: String(b.props.kind), id: String(b.props.id), title: String(b.props.title ?? "") });
      walk(b.children);
    }
  };
  walk(blocks ?? []);
  return [...found.values()];
}

/** Open check-list items, for "Görevleri çıkar" without AI. */
export function openChecklistItems(blocks: Block[] | null | undefined): string[] {
  const out: string[] = [];
  const walk = (list: Block[] | undefined) => {
    for (const b of list ?? []) {
      if (b.type === "checkListItem" && !b.props?.checked) {
        const text = inlineToText(b.content).trim();
        if (text) out.push(text);
      }
      walk(b.children);
    }
  };
  walk(blocks ?? []);
  return out;
}

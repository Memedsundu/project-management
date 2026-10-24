import "server-only";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/** Markdown to HTML that is safe to put on a page: no scripts, no inline handlers, links to app records kept internal. */
export function markdownToSafeHtml(markdown: string) {
  const raw = marked.parse(markdown.replace(/\]\(app:\/\/([a-z]+)\/([0-9a-f-]{36})\)/g, (_m, kind: string, id: string) => `](${appHref(kind, id)})`), { async: false, gfm: true }) as string;
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "del", "input"]),
    allowedAttributes: { a: ["href", "title"], img: ["src", "alt", "title"], input: ["type", "checked", "disabled"], th: ["align"], td: ["align"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
  });
}

function appHref(kind: string, id: string) {
  const map: Record<string, string> = {
    note: `/notes/${id}`,
    task: `/tasks?open=${id}`,
    meeting: `/meetings/${id}`,
    document: `/files/d/${id}`,
    organisation: `/partners/${id}`,
    indicator: `/indicators/${id}`,
    report: `/reports/${id}`,
    collection: `/collections/${id}`,
  };
  return map[kind] ?? "#";
}

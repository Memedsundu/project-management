import { LIGHT_THEME } from "@/lib/visuals";

/**
 * The one-pager drawn on a canvas at A4 size (1240 × 1754 px, 150 dpi), so
 * the preview and the PNG for Word are the same picture. Always light, in
 * Peni's type: Instrument Serif for the heading, Geist for the rest.
 */

export const PAGE = { width: 1240, height: 1754, pad: 96 } as const;

export type OnePagerModel = {
  eyebrow: string;
  heading: string;
  subheading: string;
  stats: { value: string; label: string; note: string }[];
  chartTitle: string | null;
  chart: HTMLImageElement | null;
  pointsHeading: string;
  points: string[];
  sourceLine: string;
  emptyHint: string;
};

export type Fonts = { display: string; body: string };

/** The font stacks next/font gave the page, read from the live CSS. */
export function pageFonts(): Fonts {
  const probe = document.createElement("span");
  probe.className = "font-display";
  probe.style.cssText = "position:absolute;visibility:hidden";
  document.body.append(probe);
  const display = getComputedStyle(probe).fontFamily;
  probe.remove();
  return { display, body: getComputedStyle(document.body).fontFamily };
}

/** Wait until both families can draw on a canvas. */
export async function loadFonts(f: Fonts) {
  try {
    await Promise.all([document.fonts.load(`400 80px ${f.display}`), document.fonts.load(`600 80px ${f.body}`), document.fonts.load(`400 30px ${f.body}`)]);
  } catch {
    // Fall back to whatever is loaded; the page still draws.
  }
}

/** Lines that fit a width; the last allowed line ends with an ellipsis when there is more. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max = 99) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    let last = kept[max - 1]!;
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    kept[max - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawOnePager(ctx: CanvasRenderingContext2D, m: OnePagerModel, f: Fonts) {
  const { width: W, height: H, pad: P } = PAGE;
  const inner = W - 2 * P;
  const C = LIGHT_THEME;
  ctx.save();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  let y = P;

  if (m.eyebrow) {
    ctx.font = `500 24px ${f.body}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(wrap(ctx, m.eyebrow.toLocaleUpperCase(), inner, 1)[0] ?? "", P, y + 24);
    y += 56;
  }

  ctx.font = `400 84px ${f.display}`;
  ctx.fillStyle = C.ink;
  for (const line of wrap(ctx, m.heading || " ", inner, 2)) {
    y += 88;
    ctx.fillText(line, P, y);
  }
  if (m.subheading) {
    y += 20;
    ctx.font = `400 30px ${f.body}`;
    ctx.fillStyle = C.muted;
    for (const line of wrap(ctx, m.subheading, inner, 2)) {
      y += 40;
      ctx.fillText(line, P, y);
    }
  }
  y += 48;
  ctx.fillStyle = C.ink;
  ctx.fillRect(P, y, 72, 4);
  y += 52;

  // Headline figures: tiles of two or three across.
  if (m.stats.length) {
    const n = m.stats.length;
    const cols = n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3;
    const gap = 24;
    const tw = (inner - gap * (cols - 1)) / cols;
    const th = 236;
    m.stats.forEach((s, i) => {
      const x = P + (i % cols) * (tw + gap);
      const ty = y + Math.floor(i / cols) * (th + gap);
      ctx.fillStyle = C.panel;
      roundRect(ctx, x, ty, tw, th, 28);
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.font = `600 ${cols === 3 ? 68 : 80}px ${f.body}`;
      ctx.fillText(wrap(ctx, s.value, tw - 64, 1)[0] ?? "", x + 32, ty + 32 + (cols === 3 ? 64 : 74));
      ctx.font = `500 26px ${f.body}`;
      let ly = ty + (cols === 3 ? 140 : 152);
      for (const line of wrap(ctx, s.label, tw - 64, 2)) {
        ctx.fillText(line, x + 32, ly);
        ly += 34;
      }
      if (s.note) {
        ctx.fillStyle = C.muted;
        ctx.font = `400 22px ${f.body}`;
        ctx.fillText(wrap(ctx, s.note, tw - 64, 1)[0] ?? "", x + 32, ty + th - 28);
      }
    });
    y += Math.ceil(n / cols) * (th + gap) + 32;
  }

  const footerTop = H - P - 40;
  if (m.chart) {
    if (m.chartTitle) {
      ctx.font = `600 28px ${f.body}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(wrap(ctx, m.chartTitle, inner, 1)[0] ?? "", P, y + 28);
      y += 48;
    }
    const ratio = m.chart.naturalHeight / Math.max(1, m.chart.naturalWidth);
    const room = footerTop - y - (m.points.length ? 260 : 40);
    const h = Math.max(200, Math.min(inner * ratio, 560, room));
    const w = h / ratio > inner ? inner : h / ratio;
    ctx.drawImage(m.chart, P, y, w, h);
    y += h + 40;
  }

  if (m.points.length) {
    ctx.font = `600 28px ${f.body}`;
    ctx.fillStyle = C.ink;
    ctx.fillText(m.pointsHeading, P, y + 28);
    y += 56;
    ctx.font = `400 28px ${f.body}`;
    for (const p of m.points) {
      const lines = wrap(ctx, p, inner - 36, 3);
      if (y + lines.length * 40 > footerTop - 16) break;
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.arc(P + 8, y + 18, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.ink;
      for (const line of lines) {
        y += 40;
        ctx.fillText(line, P + 36, y);
      }
      y += 16;
    }
  }

  if (!m.stats.length && !m.chart && !m.points.length) {
    ctx.font = `400 28px ${f.body}`;
    ctx.fillStyle = C.faint;
    for (const line of wrap(ctx, m.emptyHint, inner, 3)) {
      y += 40;
      ctx.fillText(line, P, y);
    }
  }

  ctx.fillStyle = C.line;
  ctx.fillRect(P, footerTop, inner, 2);
  ctx.font = `400 22px ${f.body}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(wrap(ctx, m.sourceLine, inner, 1)[0] ?? "", P, footerTop + 40);
  ctx.restore();
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Save a data URL as a file. A blob link keeps the file name in every browser; a data link can lose it. */
export async function downloadDataUrl(url: string, filename: string) {
  const blob = await (await fetch(url)).blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * "Q3 ozeti.png": plain letters only. Browsers drop a download name with
 * Turkish letters in some cases and save the file as "download", so ö, ş,
 * ı and the rest become o, s, i; characters Windows refuses go too.
 */
export const pngName = (title: string) => {
  const plain = (title || "gorsel")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]+/g, "-")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${plain || "gorsel"}.png`;
};

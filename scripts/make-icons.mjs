/**
 * Draw the app icons: one white Instrument Serif letter on black (Peni look).
 *
 *   node scripts/make-icons.mjs u
 *
 * Run it again with another letter once the app has its name. It needs
 * Playwright's Chromium (npx playwright install chromium) and an internet
 * connection for the font. Set PW_CHROMIUM to use a Chromium already on disk.
 *
 * Writes public/icons/* (manifest, notifications), src/app/apple-icon.png,
 * src/app/icon.png and src/app/favicon.ico.
 */
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const letter = (process.argv[2] ?? "u").slice(0, 2);
const INK = "#111111";

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
await page.setContent(
  `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&display=block" rel="stylesheet"></head><body></body></html>`,
  { waitUntil: "networkidle" },
);

/** One icon as PNG bytes. `glyph` is the letter's height as a share of the icon. */
async function draw(size, { glyph = 0.44, radius = 0, background = INK, color = "#ffffff" } = {}) {
  const dataUrl = await page.evaluate(
    async ({ size, glyph, radius, background, color, letter }) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (background) {
        ctx.fillStyle = background;
        ctx.beginPath();
        ctx.roundRect(0, 0, size, size, radius * size);
        ctx.fill();
      }
      // Size the font so the letter's ink (not its line box) has the asked height, then centre the ink.
      await document.fonts.load(`100px "Instrument Serif"`);
      ctx.font = `100px "Instrument Serif"`;
      const probe = ctx.measureText(letter);
      const px = (100 * glyph * size) / (probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent);
      ctx.font = `${px}px "Instrument Serif"`;
      const m = ctx.measureText(letter);
      const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
      const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      ctx.fillStyle = color;
      ctx.fillText(letter, (size - w) / 2 + m.actualBoundingBoxLeft, (size - h) / 2 + m.actualBoundingBoxAscent);
      return canvas.toDataURL("image/png");
    },
    { size, glyph, radius, background, color, letter },
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** A .ico holding PNG images (every current browser reads these). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// Full-bleed squares: phones round the corners themselves. The letter stays
// inside the maskable safe zone (a circle of 80% of the width).
await writeFile("public/icons/icon-192.png", await draw(192));
await writeFile("public/icons/icon-512.png", await draw(512));
await writeFile("public/icons/maskable-512.png", await draw(512, { glyph: 0.4 }));
await writeFile("src/app/apple-icon.png", await draw(180));
// Android shows the badge as a white shape in the status bar.
await writeFile("public/icons/badge-72.png", await draw(72, { glyph: 0.7, background: null }));
// Browser tabs: a rounded tile with a bigger letter.
await writeFile("src/app/icon.png", await draw(96, { glyph: 0.56, radius: 0.22 }));
const tab = [];
for (const size of [16, 32, 48]) tab.push({ size, png: await draw(size, { glyph: 0.6, radius: 0.22 }) });
await writeFile("src/app/favicon.ico", ico(tab));

await browser.close();
console.log(`Icons drawn with “${letter}”.`);

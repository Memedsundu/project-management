import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Every word on screen exists in both languages, with the same {values} to fill in. */
const DIR = path.resolve(import.meta.dirname, "../../messages");
const jsonFiles = (lang: string) =>
  readdirSync(path.join(DIR, lang))
    .filter((f) => f.endsWith(".json"))
    .sort();

function flatten(value: unknown, prefix = "", out = new Map<string, string>()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, String(value));
  }
  return out;
}

const read = (lang: string, file: string) => flatten(JSON.parse(readFileSync(path.join(DIR, lang, file), "utf8")));

/**
 * The names of the values a message fills in, such as {date} or
 * {count, plural, one {...} other {...}}; the text inside the plural and
 * select branches can hold more of them.
 */
function argNames(message: string) {
  const names = new Set<string>();
  let i = 0;
  const text = () => {
    while (i < message.length && message[i] !== "}") {
      if (message[i++] === "{") argument();
    }
  };
  const argument = () => {
    const name = /^\s*([A-Za-z]\w*)\s*/.exec(message.slice(i));
    if (name) {
      names.add(name[1]!);
      i += name[0].length;
    }
    while (i < message.length && message[i] !== "}") {
      if (message[i++] === "{") {
        text();
        i++;
      }
    }
    i++;
  };
  text();
  return [...names].sort();
}

describe("messages", () => {
  it("has the same files in Turkish and English", () => {
    expect(jsonFiles("en")).toEqual(jsonFiles("tr"));
  });

  for (const file of jsonFiles("tr")) {
    it(`${file}: same keys and values in both languages`, () => {
      const tr = read("tr", file);
      const en = read("en", file);
      expect([...en.keys()].sort()).toEqual([...tr.keys()].sort());
      const mismatched = [...tr].filter(([key, text]) => en.has(key) && argNames(text).join() !== argNames(en.get(key)!).join()).map(([key]) => key);
      expect(mismatched).toEqual([]);
    });
  }
});

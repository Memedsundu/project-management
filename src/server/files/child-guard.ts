import { foldText } from "@/lib/fold";

/**
 * The workspace must hold no data about individual children. This guard
 * looks for the shapes such data usually has (identity numbers, lists of
 * names with ages, beneficiary tables) and holds a file back from Claude
 * until she checks it. It is a safety net, not a guarantee.
 */

export type GuardResult = { flag: boolean; reasons: string[] };

/** Turkish identity number (TCKN) checksum. */
export function isTckn(s: string) {
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = s.split("").map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d10 === d[9] && d11 === d[10];
}

// Turkish words take suffixes ("okulu", "yaşı"), so most stems match at the start only.
const CHILD_WORDS = /\b(cocuk|cocug|ogrenci|veli|yasinda|sinif|okul|child|pupil|student|guardian|parent|aged\b|grade\b|school)/;
const NAME_HEADER = /\b(ad\b|adi\b|ad soyad|adi soyadi|isim|soyad|name\b|full name|first name|surname|last name)/;
const PERSON_HEADER = /\b(yas|age\b|dogum|birth|dob\b|tc\b|t\.c|tckn|kimlik|id no|veli|parent|guardian|okul|school|sinif|grade\b|cinsiyet|gender)/;

export function checkForChildData(input: { text: string; headers?: string[][] }): GuardResult {
  const reasons: string[] = [];
  const text = input.text ?? "";
  const folded = foldText(text);

  // Identity numbers.
  const ids = new Set<string>();
  for (const m of text.matchAll(/(?<!\d)([1-9]\d{10})(?!\d)/g)) if (isTckn(m[1]!)) ids.add(m[1]!);
  if (ids.size >= 3 || (ids.size >= 1 && CHILD_WORDS.test(folded))) reasons.push(`tckn:${ids.size}`);

  // Tables that look like lists of people with ages, schools or parents.
  for (const row of input.headers ?? []) {
    const cells = row.map((c) => foldText(c));
    const hasName = cells.some((c) => NAME_HEADER.test(c));
    const personal = cells.filter((c) => PERSON_HEADER.test(c)).length;
    if (hasName && personal >= 1) {
      reasons.push(`table:${row.slice(0, 6).join(", ")}`);
      break;
    }
  }

  // "Ayşe (12)", "Mehmet, 14 yaşında", "aged 13".
  let ages = 0;
  for (const _ of text.matchAll(/\b\p{Lu}\p{Ll}+(?:\s\p{Lu}\.?)?\s*(?:\((?:[5-9]|1[0-7])\)|,?\s*(?:[5-9]|1[0-7])\s*(?:yaşında|yaş|yasinda|years? old|y\/o))/gu)) {
    void _;
    ages++;
    if (ages >= 3) break;
  }
  if (ages >= 3) reasons.push(`name_age:${ages}`);

  return { flag: reasons.length > 0, reasons };
}

export function reasonText(reasons: string[], locale: "tr" | "en" = "tr") {
  return reasons
    .map((r) => {
      const [kind, detail] = r.split(/:([\s\S]*)/);
      if (kind === "tckn") return locale === "en" ? `${detail} Turkish ID numbers` : `${detail} T.C. kimlik numarası`;
      if (kind === "table") return locale === "en" ? `a table of people (${detail})` : `kişi listesi gibi bir tablo (${detail})`;
      if (kind === "name_age") return locale === "en" ? "names with ages" : "yaşlarıyla birlikte adlar";
      return r;
    })
    .join("; ");
}

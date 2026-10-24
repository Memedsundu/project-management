/**
 * Which Claude model each helper uses, and what tokens cost.
 * Prices are USD per million tokens (October 2026). She can change the model
 * of any helper in Ayarlar → Yapay zekâ.
 */

export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export const HELPERS = {
  classify: { model: MODELS.haiku, labelTr: "Belge sınıflandırma", labelEn: "File filing" },
  ocr: { model: MODELS.haiku, labelTr: "Taranmış sayfa okuma", labelEn: "Reading scanned pages" },
  organize: { model: MODELS.haiku, labelTr: "Klasör düzenleme önerileri", labelEn: "Organize suggestions" },
  extractTasks: { model: MODELS.haiku, labelTr: "Görevleri çıkar", labelEn: "Extract tasks" },
  parseDate: { model: MODELS.haiku, labelTr: "Tarih anlama", labelEn: "Date phrases" },
  dailyBrief: { model: MODELS.haiku, labelTr: "Günlük özet", labelEn: "Daily brief" },
  weeklyReview: { model: MODELS.haiku, labelTr: "Haftalık değerlendirme", labelEn: "Weekly review" },
  partnerBrief: { model: MODELS.haiku, labelTr: "Ortak brifi", labelEn: "Partner brief" },
  meetingRecap: { model: MODELS.haiku, labelTr: "Toplantı özeti", labelEn: "Meeting recap" },
  prepBrief: { model: MODELS.haiku, labelTr: "Toplantı hazırlığı", labelEn: "Meeting prep" },
  columnMapping: { model: MODELS.haiku, labelTr: "Excel sütun eşleme", labelEn: "Excel column mapping" },
  workplanHelper: { model: MODELS.haiku, labelTr: "İş planı önerileri", labelEn: "Workplan suggestions" },
  recipe: { model: MODELS.haiku, labelTr: "Tarifler", labelEn: "Recipes" },
  writing: { model: MODELS.sonnet, labelTr: "Yazma araçları ve çeviri", labelEn: "Writing tools and translation" },
  ask: { model: MODELS.sonnet, labelTr: "Sor (kaynaklı yanıtlar)", labelEn: "Ask (cited answers)" },
  assistant: { model: MODELS.sonnet, labelTr: "Asistan paneli", labelEn: "Assistant panel" },
  transcript: { model: MODELS.sonnet, labelTr: "Döküm birleştirme", labelEn: "Transcript merge" },
  followupEmail: { model: MODELS.sonnet, labelTr: "Takip e-postası", labelEn: "Follow-up email" },
  compareVersions: { model: MODELS.sonnet, labelTr: "Ne değişti?", labelEn: "What changed?" },
  indicatorReader: { model: MODELS.sonnet, labelTr: "Gösterge okuyucu", labelEn: "Indicator reader" },
  numberCheck: { model: MODELS.sonnet, labelTr: "Sayı kontrolü", labelEn: "Number check" },
  visuals: { model: MODELS.sonnet, labelTr: "Görseller", labelEn: "Visuals" },
  studio: { model: MODELS.sonnet, labelTr: "Koleksiyon çıktıları", labelEn: "Collection outputs" },
  reportTemplate: { model: MODELS.sonnet, labelTr: "Rapor şablonu okuma", labelEn: "Report template reading" },
  reportDraft: { model: MODELS.opus, labelTr: "Rapor taslağı", labelEn: "Report drafts" },
} as const;

export type HelperKey = keyof typeof HELPERS;

type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** Rates per million tokens. Haiku has a second, higher card for prompts over 100K tokens. */
export function rateFor(model: string, promptTokens: number): Rate {
  if (model.startsWith("claude-haiku-5")) {
    const long = promptTokens > 100_000;
    const input = long ? 0.5 : 0.1;
    const output = long ? 2.5 : 0.5;
    return { input, output, cacheRead: input * 0.1, cacheWrite: input * 1.25 };
  }
  if (model.startsWith("claude-sonnet-5")) return { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
  if (model.startsWith("claude-opus-5")) return { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
  // Unknown model: assume Opus prices so the cap errs on the safe side.
  return { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 };
}

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function costOf(model: string, usage: Usage, batch = false) {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const rate = rateFor(model, input + read + write);
  const usd = (input * rate.input + output * rate.output + read * rate.cacheRead + write * rate.cacheWrite) / 1_000_000;
  return batch ? usd / 2 : usd;
}

/** Voyage voyage-4 embeddings: USD per million tokens. */
export const VOYAGE_PRICE_PER_MTOK = 0.06;

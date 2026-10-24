import { describe, expect, it } from "vitest";
import { describeRule, nextOccurrence, parseTaskInput, splitLines } from "@/lib/parse-task";

// Saturday 24 October 2026
const today = "2026-10-24";
const partners = [
  { id: "a", name: "Ortak A Derneği", shortName: "Ortak A" },
  { id: "b", name: "Ortak B Vakfı", shortName: "Ortak B" },
];
const p = (text: string) => parseTaskInput(text, { today, partners });

describe("quick add parser", () => {
  it("reads the example from the plan", () => {
    const r = p("cuma 14:00 Ortak A ile bütçe #rapor");
    expect(r.dueDate).toBe("2026-10-30");
    expect(r.dueTime).toBe("14:00");
    expect(r.orgId).toBe("a");
    expect(r.tags).toEqual(["rapor"]);
    expect(r.title).toBe("Ortak A ile bütçe");
  });

  it("knows today, tomorrow and the day after", () => {
    expect(p("bugün rapor oku").dueDate).toBe("2026-10-24");
    expect(p("yarın ara").dueDate).toBe("2026-10-25");
    expect(p("öbür gün ara").dueDate).toBe("2026-10-26");
    expect(p("call them tomorrow").dueDate).toBe("2026-10-25");
    expect(p("yarın ara").title).toBe("ara");
  });

  it("knows weekdays with Turkish endings", () => {
    expect(p("pazartesiye kadar gönder").dueDate).toBe("2026-10-26");
    expect(p("cumartesi").dueDate).toBe("2026-10-24");
    expect(p("salı günü toplantı").dueDate).toBe("2026-10-27");
    expect(p("haftaya cuma sunum").dueDate).toBe("2026-10-30");
    expect(p("haftaya ara").dueDate).toBe("2026-10-31");
    expect(p("gelecek hafta plan").dueDate).toBe("2026-10-26");
  });

  it("knows day-of-month phrases and dates", () => {
    expect(p("ayın 15'i rapor").dueDate).toBe("2026-11-15");
    expect(p("ayın 28'inde rapor").dueDate).toBe("2026-10-28");
    expect(p("15 kasım bütçe").dueDate).toBe("2026-11-15");
    expect(p("3 Ocak 2027 sunum").dueDate).toBe("2027-01-03");
    expect(p("15.11 rapor").dueDate).toBe("2026-11-15");
    expect(p("2026-12-01 rapor").dueDate).toBe("2026-12-01");
    expect(p("nov 3 report").dueDate).toBe("2026-11-03");
    expect(p("ay sonu kapanış").dueDate).toBe("2026-10-31");
    expect(p("3 gün sonra dön").dueDate).toBe("2026-10-27");
    expect(p("in 2 weeks review").dueDate).toBe("2026-11-07");
  });

  it("reads times", () => {
    expect(p("yarın 9:30 ara").dueTime).toBe("09:30");
    expect(p("yarın saat 3'te ara").dueTime).toBe("15:00");
    expect(p("cuma 14'te").dueTime).toBe("14:00");
    expect(p("14.30 telefon").dueTime).toBe("14:30");
    expect(p("14.30 telefon").dueDate).toBe(today);
    expect(p("3pm call").dueTime).toBe("15:00");
  });

  it("reads priority, owner and estimate", () => {
    const r = p("+Ortak B veri gönder p1 30dk");
    expect(r.priority).toBe(1);
    expect(r.ownerOrgId).toBe("b");
    expect(r.estimateMin).toBe(30);
    expect(r.title).toBe("veri gönder");
    expect(p("+Ayşe imza al").ownerName).toBe("Ayşe");
    expect(p("1,5 saat analiz").estimateMin).toBe(90);
  });

  it("reads start date and deadline separately", () => {
    const r = p("başla pazartesi son tarih cuma ToR yaz");
    expect(r.startDate).toBe("2026-10-26");
    expect(r.dueDate).toBe("2026-10-30");
    expect(r.title).toBe("ToR yaz");
  });

  it("reads repeats", () => {
    const r = p("her ayın 5'i ortak raporu");
    expect(r.recurrence).toBe("FREQ=MONTHLY;BYMONTHDAY=5");
    expect(r.dueDate).toBe("2026-11-05");
    expect(r.title).toBe("ortak raporu");
    const q = p("her çeyreğin son cuma günü bağışçı raporu");
    expect(q.recurrence).toBe("FREQ=YEARLY;BYMONTH=3,6,9,12;BYDAY=-1FR");
    expect(q.dueDate).toBe("2026-12-25");
    expect(p("her pazartesi haftalık plan").recurrence).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(p("every weekday standup").recurrence).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(p("her ayın son günü kapanış").recurrence).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
    expect(p("her ayın ilk pazartesi toplantı").recurrence).toBe("FREQ=MONTHLY;BYDAY=+1MO");
  });

  it("leaves plain text alone", () => {
    const r = p("Mevsimlik tarım raporunu oku");
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe("Mevsimlik tarım raporunu oku");
  });

  it("splits pasted lists", () => {
    expect(splitLines("- bir\n* iki\n\n3. üç\n[ ] dört")).toEqual(["bir", "iki", "üç", "dört"]);
  });

  it("computes the next occurrence and labels rules", () => {
    expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=5", "2026-11-05", false)).toBe("2026-12-05");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=5")).toBe("her ayın 5'i");
    expect(describeRule("FREQ=YEARLY;BYMONTH=3,6,9,12;BYDAY=-1FR")).toBe("her çeyreğin son cuma günü");
  });
});

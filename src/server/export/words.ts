import "server-only";

/**
 * Names and texts inside the export ZIP, in the language she exports in.
 * Folder and file names are what she sees in Explorer or Finder, so they
 * read as words, not codes.
 */
export function archiveWords(en: boolean) {
  if (en) {
    return {
      exportName: "export",
      partOf: (n: number, total: number) => `part ${n} of ${total}`,
      dataFile: "data/project-data.json",
      readme: "README.txt",
      indexFile: "Index.html",
      dirs: { files: "Files", olderVersions: "_Older versions", notes: "Notes", daily: "Daily notes", meetings: "Meetings", reports: "Reports", briefs: "Briefs" },
      workbooks: { tasks: "Tasks.xlsx", iptt: "Indicators (IPTT).xlsx", workplan: "Workplan.xlsx", decisions: "Decisions.xlsx", partners: "Partners and contacts.xlsx" },
      untitled: "Untitled page",
      version: (n: number) => `version ${n}`,
      meeting: {
        when: "When",
        where: "Where",
        online: "Online",
        partners: "Partners",
        attendees: "Attendees",
        agenda: "Agenda",
        notes: "Notes",
        recap: "Summary",
        decisions: "Decisions",
        actions: "Actions",
        questions: "Open questions",
        nextSteps: "Next steps",
        prep: "Preparation",
        followup: "Follow-up email draft",
        transcript: "Transcript",
        due: "due",
      },
      index: {
        title: "Project export",
        exported: "Exported",
        part: (n: number) => `Part ${n}`,
        inPart: (n: number) => `in part ${n}`,
        workbooks: "Spreadsheets",
        notes: "Notes",
        meetings: "Meetings",
        reports: "Reports",
        files: "Files",
        briefs: "Briefs",
        older: "older versions",
        more: (n: number) => `${n} more`,
        none: "Nothing here.",
        noFiles: "This export was made without the files.",
        held: "Held by the child-data check, not in this export",
        counts: (c: Record<string, number>) => `${c.tasks} tasks · ${c.notes} pages · ${c.meetings} meetings · ${c.documents} files · ${c.organisations} organisations`,
        open: "Unzip the archive into a folder first; the links work from there.",
        draft: "Draft",
        final: "Final",
      },
      readmeText: (r: ReadmeInput) =>
        [
          `${r.appName} · ${r.projectName}`,
          `Exported on ${r.when} (Istanbul time)${r.part ? ` · ${r.part}` : ""}`,
          "",
          r.closed ? `The project was closed on ${r.closed}. This is a copy of the read-only archive.\n` : "",
          r.partOnlyFiles
            ? "This part holds files only. The index page, the spreadsheets and the data file are in part 1."
            : "This ZIP holds the whole project. Unzip it into a folder, then open Index.html: everything is linked from there, no internet needed.",
          "",
          "Contents",
          r.files ? "- Files/: the files you uploaded, in the app's folders. Earlier versions are under Files/_Older versions." : "- Files: not included (this export was made without files).",
          "- Notes/: every page as Markdown (.md) and Word (.docx). Sub-pages sit in a folder named after their parent page.",
          "- Meetings/: every meeting with its agenda, notes, summary and decisions (.md and .docx).",
          "- Reports/: every report in Word and Markdown, with its source list.",
          "- Briefs/: daily briefs, weekly reviews and partner report checks.",
          "- Tasks.xlsx, Indicators (IPTT).xlsx, Workplan.xlsx, Decisions.xlsx, Partners and contacts.xlsx",
          "- data/project-data.json: the data file the app can restore (Settings › Data › Restore from a backup). Do not edit it.",
          r.parts > 1 ? `\nThe export has ${r.parts} parts; the files are spread over them. To restore, choose all ${r.parts} ZIP files together.` : "",
          "",
          "Left out",
          "- Items in the trash.",
          "- Files the child-data check is holding (listed below). Check them in the app first: upload a cleaned version or delete them.",
          "- Passkeys, sign-ins, notification permissions and the search index: a restore makes them again.",
          r.held.length ? `\nHeld files (${r.held.length})\n${r.held.map((h) => `- ${h.title}${h.reason ? ` (${h.reason})` : ""}`).join("\n")}` : "",
          "",
          "These files are project data. Before sharing them with partners or anyone else, follow your organisation's data rules.",
          "",
        ]
          .filter((l, i, all) => l !== "" || all[i - 1] !== "")
          .join("\r\n"),
    };
  }
  return {
    exportName: "dışa aktarım",
    partOf: (n: number, total: number) => `bölüm ${n}-${total}`,
    dataFile: "veri/proje-verisi.json",
    readme: "BENİOKU.txt",
    indexFile: "Dizin.html",
    dirs: { files: "Belgeler", olderVersions: "_Önceki sürümler", notes: "Notlar", daily: "Günlük notlar", meetings: "Toplantılar", reports: "Raporlar", briefs: "Özetler" },
    workbooks: { tasks: "Görevler.xlsx", iptt: "Göstergeler (IPTT).xlsx", workplan: "İş planı.xlsx", decisions: "Kararlar.xlsx", partners: "Ortaklar ve kişiler.xlsx" },
    untitled: "Adsız sayfa",
    version: (n: number) => `sürüm ${n}`,
    meeting: {
      when: "Zaman",
      where: "Yer",
      online: "Çevrim içi",
      partners: "Ortaklar",
      attendees: "Katılımcılar",
      agenda: "Gündem",
      notes: "Notlar",
      recap: "Özet",
      decisions: "Kararlar",
      actions: "Yapılacaklar",
      questions: "Açık sorular",
      nextSteps: "Sonraki adımlar",
      prep: "Hazırlık",
      followup: "Takip e-postası taslağı",
      transcript: "Döküm",
      due: "son tarih",
    },
    index: {
      title: "Proje dışa aktarımı",
      exported: "Dışa aktarıldı",
      part: (n: number) => `Bölüm ${n}`,
      inPart: (n: number) => `${n}. bölümde`,
      workbooks: "Tablolar",
      notes: "Notlar",
      meetings: "Toplantılar",
      reports: "Raporlar",
      files: "Belgeler",
      briefs: "Özetler",
      older: "önceki sürüm",
      more: (n: number) => `${n} tane daha`,
      none: "Burada bir şey yok.",
      noFiles: "Bu dışa aktarım dosyasız yapıldı.",
      held: "Çocuk verisi denetiminin beklettiği, bu arşivde olmayan dosyalar",
      counts: (c: Record<string, number>) => `${c.tasks} görev · ${c.notes} sayfa · ${c.meetings} toplantı · ${c.documents} dosya · ${c.organisations} kurum`,
      open: "Önce ZIP'i bir klasöre çıkar; bağlantılar oradan çalışır.",
      draft: "Taslak",
      final: "Son hâli",
    },
    readmeText: (r: ReadmeInput) =>
      [
        `${r.appName} · ${r.projectName}`,
        `Dışa aktarım: ${r.when} (İstanbul saati)${r.part ? ` · ${r.part}` : ""}`,
        "",
        r.closed ? `Proje ${r.closed} tarihinde kapatıldı. Bu, salt okunur arşivin bir kopyası.\n` : "",
        r.partOnlyFiles
          ? "Bu bölümde yalnızca dosyalar var. Dizin sayfası, tablolar ve veri dosyası 1. bölümde."
          : "Bu ZIP projenin tamamını içerir. Önce bir klasöre çıkar, sonra Dizin.html dosyasını aç: her şeye oradan ulaşırsın, internet gerekmez.",
        "",
        "İçindekiler",
        r.files ? "- Belgeler/: Yüklediğin dosyalar, uygulamadaki klasörleriyle. Önceki sürümler Belgeler/_Önceki sürümler altında." : "- Belgeler: Bu dışa aktarım dosyasız yapıldı.",
        "- Notlar/: Her sayfa Markdown (.md) ve Word (.docx) olarak. Alt sayfalar, üst sayfanın adını taşıyan klasörde.",
        "- Toplantılar/: Her toplantı gündemi, notları, özeti ve kararlarıyla (.md ve .docx).",
        "- Raporlar/: Her rapor Word ve Markdown olarak, kaynak listesiyle.",
        "- Özetler/: Günlük özetler, haftalık değerlendirmeler ve ortak raporu kontrolleri.",
        "- Görevler.xlsx, Göstergeler (IPTT).xlsx, İş planı.xlsx, Kararlar.xlsx, Ortaklar ve kişiler.xlsx",
        "- veri/proje-verisi.json: Uygulamaya geri yüklenebilen veri dosyası (Ayarlar › Veri › Yedekten geri yükle). Bu dosyayı düzenleme.",
        r.parts > 1 ? `\nDışa aktarım ${r.parts} bölüm; dosyalar bölümlere dağıtıldı. Geri yüklemek için ${r.parts} ZIP dosyasını birlikte seç.` : "",
        "",
        "Dışarıda kalanlar",
        "- Çöp kutusundaki öğeler.",
        "- Çocuk verisi denetiminin beklettiği dosyalar (aşağıda). Önce uygulamada kontrol et: temizlenmiş bir sürüm yükle ya da sil.",
        "- Geçiş anahtarları, oturumlar, bildirim izinleri ve arama dizini: geri yüklemede yeniden oluşur.",
        r.held.length ? `\nBekletilen dosyalar (${r.held.length})\n${r.held.map((h) => `- ${h.title}${h.reason ? ` (${h.reason})` : ""}`).join("\n")}` : "",
        "",
        "Bu dosyalar proje verisidir. Ortaklarla ya da başka biriyle paylaşmadan önce kurumunun veri kurallarına uy.",
        "",
      ]
        .filter((l, i, all) => l !== "" || all[i - 1] !== "")
        .join("\r\n"),
  };
}

export type ArchiveWords = ReturnType<typeof archiveWords>;

export type ReadmeInput = {
  appName: string;
  projectName: string;
  when: string;
  part: string | null;
  parts: number;
  partOnlyFiles: boolean;
  files: boolean;
  closed: string | null;
  held: { title: string; reason: string | null }[];
};

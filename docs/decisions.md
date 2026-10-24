# Decisions

Mehmet approved the plan on 24 October 2026 and asked for the open questions to
follow Claude's recommendations. These are the choices made while building, so
they can be revisited with her once she uses the app. Each one names the app it
follows.

## Everywhere

- Claude only suggests. Every AI result arrives as a card she approves, edits or
  rejects; nothing in her workspace changes on its own.
- Files marked "Yapay zekâya kapalı" never reach Claude or Voyage.
- No data about individual children. A guard checks uploads and imports for
  names with ages, ID numbers and similar, and blocks or flags them.
- The monthly AI budget is 20 USD by default; calls stop at the limit.

## İş planı (workplan)

- Moving an activity later shifts the activities that wait for it only when
  they would now overlap, to the next working day. A planned gap stays (Asana's
  "consume buffer"; a training moved by a week should not push a meeting planned
  for after the harvest). Every move shows an undo toast.
- Excel import does not store the file. The column mapping is remembered per
  header layout; for a new layout Claude maps the columns from the headers and
  the first five values (Smartsheet and Airtable import, with Claude in place of
  fixed rules). Rows with "Çıktı 1" or a code that is the prefix of other codes
  become outputs in the logframe.
- Harvest seasons are hatched grey bands behind the timeline, with ready-made
  ones for hazelnut, cotton, apricot, sugar beet, citrus and tea. Late items are
  amber; at-risk items have a dashed amber outline. No other colours.
- Claude's preparation ideas come as one card per activity. They also run by
  themselves every Monday at 09:00 for planned activities that start within six
  weeks and have no tasks yet, and skip an activity that had ideas in the last 60
  days. On the workplan they stay folded behind one button, so the plan is the
  first thing on the screen.
- Export is an Excel Gantt in the layout donors expect (activity rows under
  outputs, a column per month).
- The calendar is a month or week grid on a laptop and an agenda list on a phone.

## Göstergeler (indicators)

- The IPTT has one row per indicator under its logframe item, and actual over
  target per quarter (the IPTT used in donor reporting). "Bugüne kadar" compares
  the sum so far with the targets up to the last period that has a value, so a
  quarter not yet reported does not count as a shortfall. Under 90% is "Geride"
  and amber, over 110% is "Önde".
- Cumulative indicators (counts) add up their period values; others (rates,
  levels, percentages) take the latest value. Values can be a total, one group
  (Kız: 140) or a cross-table; the most aggregated level present is used, so
  nothing is counted twice.
- Quarters are the table's columns and come ready from the project years. A
  project whose year starts in another month rebuilds them as project quarters
  ("Y1 Q1" = Sep–Nov) while no value is recorded. Months, halves and custom
  periods stay for reports and files.
- Every value can carry its source file and page, and opens that page
  (ActivityInfo's "a source for every number"). Claude reads partner reports
  only into the IPTT's quarters; a number for a longer stretch goes to the
  last quarter inside it, with a note.
- Charts are monochrome: ink for actual, faint grey for target, told apart by
  shape too (bar against a tick, solid against dashed). The life-of-project line
  shows only when it is near the data. Every chart has its table next to it.
- "Neden geride?" appears only for an indicator that is behind. Claude drafts it
  from the linked meetings, notes and files; she edits it and can keep it as a
  note linked to the indicator.
- "Proje hedefini dönemlere dağıt" splits a count evenly (the last quarter takes
  the remainder) and climbs evenly from the baseline for a rate; undo restores
  the earlier targets.
- A logframe item goes to the trash only when nothing sits under it. Outputs an
  imported workplan put at the top can be moved under an outcome.
- The Excel export has three sheets: the IPTT, every value with its source, and
  the definitions (PIRS).

## Koleksiyonlar (collections)

- A collection gathers records for one purpose and leaves them where they live
  (Dropbox Dash Stacks). A record can sit in several collections; removing it
  from one never deletes it, and the toast offers undo.
- A smart collection is a saved filter (Paperless saved views): words, kinds,
  partner, file type, tag and dates. It needs at least one condition, shows a
  live count while she sets it up, and keeps her hand-picked items too.
- The collection page works like a NotebookLM notebook: sources on the left,
  the chat in the middle, Studio outputs on the right. A laptop narrower than
  about 1500 px shows sources and outputs as two tabs beside the chat; a phone
  shows one of the three at a time.
- Every source has a tick box, all ticked by default. The chat and the outputs
  read only the ticked ones. Items marked "Yapay zekâya kapalı" or flagged for
  child data show a lock and are never sent.
- Chat answers come from Claude's citations feature, one line per source under
  each answer, and stay in the collection like NotebookLM's chat. Asking works
  in an archived (read-only) project, as in Sor.
- Studio makes five drafts: a brief, talking points, a slide outline, an email
  to a partner and a report section. They are written in English by default
  (the working language), the partner email in Turkish; she can switch. Each
  draft keeps its citations and can be copied or saved as a normal note linked
  to the collection and to the sources it cites. Saved notes are listed under
  the outputs but are not sources unless she adds them.
- Picking a collection in any record's "Bağlantılar" puts the record in that
  collection.
- A collection in the trash keeps its chat and outputs for 30 days; emptying
  the trash deletes them with it. Notes saved from them stay.

## Telefon ve bildirimler (phone, offline and push)

- The app installs from the browser (PWA): "Ana ekrana ekle" on iPhone, the
  install button in Chrome or Edge. It opens on Bugün. Long-pressing the icon
  on Android offers Hızlı ekle, Görevler, Bugün and Ara. The manifest takes the
  app's name from Ayarlar.
- The icon is a white Instrument Serif "u" on black, a placeholder like the
  name. `node scripts/make-icons.mjs <letter>` draws a new set once the app has
  a name. iPhone start-up images are left out; iOS shows a white screen for a
  moment instead.
- Offline reading: the service worker (`public/sw.js`) keeps the last 60 pages
  she opened on that device, network first. With no signal, or a network
  slower than 5 seconds, it shows the kept copy and the page says so with the
  time it was saved. A page never opened shows the offline page, which lists
  what can be read. Pages with a query (a search, an open drawer) are kept only
  when loaded in full, so the app does not re-run searches in the background.
- Offline capture: Hızlı ekle saves tasks and notes in the browser when there
  is no connection and sends them, oldest first, once it is back (Todoist,
  Things). A banner shows how many wait. Files need a connection. If the
  connection drops in the middle of sending, one item can arrive twice; that is
  rare and easy to delete, so the server keeps no extra bookkeeping for it.
- Signing out first sends what waits, then deletes the kept pages and the list
  from that device. A session that ends on its own also clears the kept pages
  the next time the sign-in page opens. Sign-out is now also in the phone menu.
- Push reminders use Web Push with keys made by the app (no outside service to
  sign up for). Each device gets its texts in the language it subscribed in.
  Quiet hours apply to everything except reminders she set herself. On an
  iPhone, push works only from the home-screen app (iOS 16.4 or later).
- The service worker runs only in the built app, never in development.
- On Android the keyboard shrinks the page (`interactive-widget`), so inputs
  stay above it; the bottom bar steps aside while she types.

## Ayarlar ve Çöp kutusu (settings and trash)

- Ayarlar is one page with a section list beside it (Linear, Stripe): Proje,
  Görünüm ve dil, Çalışma saatleri, Bildirimler, Telefona yükle, Yapay zekâ,
  Listeler, Hesap, Veri. On a phone the list is a row of chips. Switches save
  the moment she flips them; forms with several fields (Proje, Çalışma
  saatleri) have a Kaydet button that appears once something changed.
- Settings that are not project data (look, notifications, account) still
  change when the project is archived; everything else turns read-only.
- Yapay zekâ shows this month's spend against the cap, a meter that turns
  amber at 80%, spend by job, the folders and files closed to AI, and a button
  into Claude's memory. Models per job sit behind "Göster"; a choice equal to
  the default is not stored, so a later default change reaches it.
- Listeler opens each list in its own window, and the window starts from what
  is saved each time. File types: a removed type with files asks where those
  files go (Paperless). Tags: renaming a tag to the name of another merges
  them (Bear). Templates: hers can be renamed or deleted, the built-in ones
  stay. Seasons, holidays and reporting periods reuse the windows from the
  workplan and indicators pages.
- Hesap: passkeys with rename and remove (the last one cannot go), "Bu cihaza
  passkey ekle", "Yeni cihaz ekle" with a six-digit code valid for ten minutes
  (the code the sign-in page asks for), new recovery codes shown once with copy
  and download, and the devices signed in with sign-out per device or for all
  others. Adding a passkey on a device that already has one says so plainly.
- The trash follows Google Drive and Notion: deleting a folder takes its files
  and subfolders with it, deleting a page takes its subpages. The trash lists
  the folder or page once, with how many items are inside; restoring brings
  them all back, and deleting forever removes them all. A file restored while
  its folder is still in the trash comes back at the top of Belgeler. Things
  deleted separately before stay separate rows. Items go for good after 30
  days; each row shows the days left.
- Çöp kutusu is in the menu under Ayarlar, and in Ayarlar › Veri.

## Raporlar ve görseller (reports and visuals)

- A report works like NotebookLM: she picks its sources (files, notes,
  meetings, indicators, collections), and Claude drafts each section only from
  them, with numbered citations she can open. "2026 Q2 için öner" suggests
  sources from the report's period: indicators with values in it and things
  dated inside it. Text inside the sources is data, never instructions, and
  files closed to AI are left out.
- A draft waits in a box on the section, as in Notion AI: "Kullan" replaces
  the text, "Sonuna ekle" adds it after hers (its citation numbers move past
  hers), "Vazgeç" drops it. Nothing reaches the section until she chooses.
  Quick rewrites: from the sources again, shorter, more formal, numbers first,
  or her own instruction.
- Templates are her donors' formats: "Şablonu oku" reads a donor template file
  into sections with guidance and word limits; a report can be saved as a
  template. Two built-in templates (quarterly narrative, annual report).
  "Yeni dönem için kopyala" keeps the sections, guidance and word limits; text
  and sources start empty, since the next period has its own.
- Sayı kontrolü compares every figure in a section with the IPTT for the
  report's period (approved values only). A mismatch is marked amber in the
  text and in the outline. The check remembers a fingerprint of the text, so
  an edit afterwards shows "Kontrolden sonra metin değişti" instead of old
  marks on new text.
- Export: Word with the citations renumbered across the whole report (the same
  file and page keeps one number) as superscripts and a Kaynaklar list at the
  end; a second Word without numbers for donors who want plain text; PDF
  through the print view (the browser's "Save as PDF"). The words in the file
  ("Sources", "Draft", "Due") follow the report's language, not the screen's.
- Models: Opus drafts sections; Sonnet reads templates, checks numbers and
  proposes charts.
- A chart or one-pager stores what to show, not the numbers: it is drawn from
  the live IPTT and workplan each time it opens, with "as of" in its source
  line, so it never goes stale.
- Charts follow the dataviz rules: Peni's black for the first series, amber
  for the second, grey for the third, a faint grey for targets; one axis; a
  legend from two series; a data table under every chart; percentages are
  never stacked. A partner
  keeps its colour in every chart (slots follow her partner list, not the size
  of the numbers); after three partners the rest fold into "Diğer".
- A visual has its own language, English by default (the donors' and working
  language), so an English chart can be made from the Turkish screen. Claude's
  proposals are written in that language.
- PNGs are drawn in the browser at twice print size; the report's Word file
  does not embed them, so she places the picture she wants where she wants it.
  PNG names use plain letters ("Hanelere ulasim.png"): some browsers drop a
  name with Turkish letters and save "download".
- The one-pager is an A4 page drawn on a canvas, so the preview and the PNG
  are the same picture: heading in Instrument Serif, up to six figures from
  the IPTT, one of her charts, highlights and a source line. Claude can fill
  it from a period; the figures themselves always come from the IPTT.
- On a phone the chart or page comes first and the settings follow; on a
  laptop the picture stays in view while she scrolls the settings.

## Yardımcılar, kayıtlı talimatlar ve görev setleri (helpers, saved instructions and task sets)

- Three scheduled helpers, as Notion's custom agents: the day's summary on
  working days at 08:00, the Friday review at 16:00 (done, slipped, next week
  and at most three objectives, as Sunsama's weekly objectives) and the
  partner report check on the first working day of the month. Each one has
  its own switch in Ayarlar › Yardımcılar. Weekends and the holidays in İş
  planı › Tatiller are skipped.
- Whatever they write is kept on Özetler, newest first, by month. Özetler is
  not in the sidebar, to keep it short: it opens from Bugün ("Tüm özetler"),
  from Ayarlar, from ⌘K and with G then Z. Bugün offers the ones she has not
  opened yet; opening one marks it read. "Şimdi hazırla" writes one now.
- A brief can be copied, kept as a note (linked to the page it was about),
  written again or deleted. A past day's summary cannot be written again:
  that day's records have moved on.
- Helpers never change data. The partner report check suggests one follow-up
  task per late report; the suggestion waits in Gelen kutusu for her approval
  and is not repeated while one is open. Without AI (no key, switched off or
  over the monthly cap) the day's summary, the review and the check are still
  written from the records, plainly.
- "Kayıtlı talimatlar" is the Turkish name for Granola's recipes and Notion's
  skills: saved instructions she runs with one tap in the assistant panel. On
  a partner or meeting page they run with that page's records. Each names its
  own model (Haiku by default) and can run on a schedule (every working day
  08:00, Friday 16:00, first working day of the month). Three come built in:
  Ortak brifi, Haftalık güncelleme, Toplantıya hazırla; she can edit them but
  not delete them. A result from a schedule arrives as a phone notification.
- Task sets are Asana's and Todoist's templates with relative dates: a set's
  tasks sit so many days before or after one day (the deadline, the start,
  the visit, the meeting or the period end). Before anything is created she
  sees every date, can leave tasks out and can link them to a partner.
- A date that falls on a weekend or holiday moves to a working day: earlier
  for work before the day, later for follow-ups after it, so nothing lands
  after a deadline. A date already past is marked in amber.
- Any group of tasks becomes a set: select them in Görevler and choose "Görev
  seti olarak kaydet". The latest date among them becomes the set's day and
  the others are kept as days before it; tasks without a date stay undated.

## Dışa aktarım, kapanış ve geri yükleme (export, closing the project and restore)

- The export follows Google Takeout and Notion's "export all workspace
  content": one ZIP, named in her language, that opens without the app or the
  internet. Inside: Belgeler/ in the app's folders (earlier versions under
  Belgeler/_Önceki sürümler), Notlar/, Toplantılar/, Raporlar/ and Özetler/ as
  Markdown and Word, five Excel workbooks (Görevler, Göstergeler (IPTT), İş
  planı, Kararlar, Ortaklar ve kişiler), Dizin.html (an index page in the
  app's look) and BENİOKU.txt. Links between pages, meetings and files are
  relative, so they keep working once the ZIP is unzipped into a folder.
- veri/proje-verisi.json is the restorable data file. It lists every table
  of her project and how the tables point at each other, so a restore can
  check it before writing anything.
- Left out: the trash, and files the child-data check holds (only their
  names leave, in BENİOKU, so she can clean or delete them). Whatever pointed
  at them is repaired the way the database would. Passkeys, sign-ins, phone
  notifications, the job queue and the search index belong to one
  installation and are made again.
- The ZIP is streamed as it is written; nothing is built in memory or on
  disk. Big projects come in parts of about 1 GB, current files first, so
  each download ends well inside the 800 seconds Vercel allows a function
  (Fluid compute). PDFs, Office files and pictures are stored as they are,
  text is compressed; ZIP64 above 4 GB, and UTF-8 names so Turkish letters
  survive on Windows and macOS.
- Text read from files (including OCR) travels in the data file, so a
  restore does not pay Claude to read every file again. The search index is
  rebuilt during the restore; search by meaning catches up in the background.
- Restore opens only on an empty workspace, such as a new installation (Ayarlar
  › Veri › Yedekten geri yükle). The browser reads the ZIP, so a large export
  never passes through the server: files go straight to storage after a
  SHA-256 check, rows follow in batches under Vercel's 4.5 MB request limit.
  A restore that stops halfway is run again with the same ZIPs; it starts
  clean and does not send files already in storage. A document whose file is
  in none of the chosen ZIPs (and not in storage) is left out, and she is
  told how many.
- Closing the project follows Basecamp's archive and Asana's "mark complete":
  a dialog shows what is still open (tasks, Gelen kutusu, files waiting for a
  check, held files) with links, then two steps: download the archive, then
  close. A closed workspace is read-only; reminders, scheduled helpers and the
  30-day trash emptying stop; reading, search, asking Claude and export go on.
  Every page shows since when it is closed, with a link to the archive. She
  can reopen it from Ayarlar › Veri.

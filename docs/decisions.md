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

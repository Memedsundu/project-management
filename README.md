# [uygulama] — proje çalışma alanı

A workspace for one project manager running a multi-year, multi-partner
project: tasks, notes and meetings, files, partners, the workplan,
indicators and reports, with Claude as a helper that only ever suggests.
The screens are in Turkish, with an English switch. "[uygulama]" is a
placeholder name; the name she sees is set in Ayarlar › Proje.

## What is in it

Each part follows the app that does that job best today.

| Screens | What they do | Follows |
| --- | --- | --- |
| Bugün, Gelen kutusu, Görevler | The day's plan, quick capture, the task list | Sunsama, Things, Todoist, Linear |
| Notlar | Pages, daily notes, templates and page history | Notion, Obsidian |
| Toplantılar | Agendas, notes, decisions and the actions they create | Granola, Fellow |
| Belgeler, Kontrol, Koleksiyonlar | Folders, versions, classification by Claude, sets of sources | Google Drive, Dropbox Dash, Paperless-ngx, NotebookLM |
| Ortaklar | The partners, their people, agreements and reporting | Attio |
| İş planı, Göstergeler | The workplan on a timeline, and the indicator table | Notion timeline, ActivityInfo, the IPTT |
| Raporlar, Özetler | Cited report drafts, charts, one-pagers, daily and weekly summaries | NotebookLM, Notion AI |
| Ara, the assistant | Search by words and meaning, answers with sources | Dropbox Dash, Notion AI, Linear ⌘K |
| Ayarlar, Çöp kutusu | Settings, sign-in devices, export, closing the project, trash | Linear, Google Drive |

Ground rules the code keeps: there is one user; there is no data about
individual children, only totals; Claude never changes her data on its own;
files marked "Yapay zekâya kapalı" are never sent to an AI service; and the
app never sends email.

## Run it on a laptop

You need Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:3000/setup to make the first account with a passkey.
On a laptop the database is PGlite (a real Postgres in a folder, migrated on
start) and files go to a local folder, both in `~/.proje-calisma-alani`, so
no cloud account is needed. `.env.example` lists the optional settings,
such as `ANTHROPIC_API_KEY` for the AI features.

## Checks

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | TypeScript, including the route types |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest), including a full export and restore round trip |
| `npm run test:e2e` | Browser tests (Playwright) on a laptop and a phone screen, with an accessibility check (WCAG 2.2 AA) of every screen in the light and dark themes |

The browser tests start their own dev server on an empty workspace in a
temporary folder. Stop `npm run dev` first, and the first time run
`npx playwright install chromium`. GitHub Actions runs all of these on every
pull request.

## Documents

- [docs/maintenance.md](docs/maintenance.md): deploying to Vercel with Neon
  and Blob, the environment variables, updates, backups and restoring, AI
  costs and troubleshooting.
- [docs/decisions.md](docs/decisions.md): the choices behind each feature.
- [AGENTS.md](AGENTS.md): conventions for working on the code.

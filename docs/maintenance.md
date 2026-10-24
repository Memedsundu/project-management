# Maintenance guide

For Mehmet. How the app is put together, how to deploy and update it, how
to keep her data safe, and what to do when something goes wrong. The choices
behind each feature are in [decisions.md](decisions.md).

## What runs where

| Part | Service | Notes |
| --- | --- | --- |
| The app (Next.js 16) | Vercel, your Pro account | Region `fra1` (Frankfurt), Fluid compute on (`vercel.json`). |
| Database | Neon Postgres | Use a Frankfurt (`aws-eu-central-1`) project, next to the app. Extensions `vector`, `pg_trgm` and `unaccent` are created by the first migration. |
| Files | Vercel Blob, a **private** store | Files never get a public URL; the app streams them after checking her sign-in. |
| AI | Anthropic API (Claude) | Every call is logged with its cost in Ayarlar › Yapay zekâ; a monthly cap (20 USD by default) stops calls at the limit. |
| Search by meaning | Voyage AI embeddings | Optional; without a key, search still works on words. |
| Scheduled work | Vercel Cron | Two routes, below. Cron runs only on the production deployment. |

There is one user. Sign-in is by passkey (Face ID, Touch ID, Windows Hello
or a phone), with ten one-time recovery codes. The app never sends email.

## Environment variables

Set these in Vercel › Project › Settings › Environment Variables. Copy
`.env.example` for a laptop.

| Variable | Needed | What it is |
| --- | --- | --- |
| `DATABASE_URL` | Production | Neon connection string (the pooled one). Scope it to **Production** only; see "Preview deployments" below. |
| `BLOB_READ_WRITE_TOKEN` | Production | Added automatically when you connect the Blob store to the project. Without it, uploads say "Dosya deposu henüz bağlı değil". |
| `APP_ORIGIN` | Production | The address she uses, for example `https://proje.example.org`. Passkeys are tied to this host name, and phone notifications and export links use it. Decide the final domain **before** she creates her passkey. |
| `SETUP_TOKEN` | First sign-in | A long random string (`openssl rand -base64 32`). It opens `/setup` once; after the first account exists, `/setup` is closed whatever the token. |
| `CRON_SECRET` | Production | A long random string. Vercel Cron sends it; the cron routes refuse calls without it. |
| `ANTHROPIC_API_KEY` | For AI | From the Anthropic Console, on your account. Without it every AI feature is hidden and the app works by hand. |
| `VOYAGE_API_KEY` | Optional | From Voyage AI, for search by meaning. |
| `APP_NAME` | Optional | The name her passkey manager shows. The name inside the app is set in Ayarlar › Proje. |
| `LOCAL_DATA_DIR`, `LOCAL_UPLOAD_DIR` | Laptop only | Where the local database and files live (default `~/.proje-calisma-alani`). |
| `E2E_LOGIN`, `ANTHROPIC_API_URL`, `EXPORT_PART_BYTES` | Tests only | Test sign-in, a mock Claude server, small export parts. These work only outside production; never set them on Vercel. |

API keys stay on the server; the browser never sees them.

## First deployment

1. **Neon.** Create a project in Frankfurt. Copy the pooled connection
   string into `DATABASE_URL` (Production).
2. **Vercel project.** Import the GitHub repository. Framework: Next.js. The
   build command in `package.json` (`npm run build`) applies the database
   migrations first, then builds, so a deployment never runs against an
   older database.
3. **Blob.** Vercel › Storage › Create › Blob, access **Private**, then
   connect it to the project (this adds `BLOB_READ_WRITE_TOKEN`).
4. **The other variables**: `APP_ORIGIN`, `SETUP_TOKEN`, `CRON_SECRET`,
   `ANTHROPIC_API_KEY`, and `VOYAGE_API_KEY` if you want search by meaning.
5. **Deploy**, then open `APP_ORIGIN/setup` on her laptop. She enters the
   setup token and her name, creates a passkey and saves the ten recovery
   codes (download or copy; they are shown once).
6. **Her phone.** Ayarlar › Hesap › "Yeni cihaz ekle" shows a six-digit
   code; on the phone she opens `/pair`, types it and creates a passkey
   there. Ayarlar › Telefona yükle explains adding the app to the home
   screen, which notifications need on an iPhone.
7. **The project.** Ayarlar › Proje: app and project names, years, provinces.
   The three partners are added in Ortaklar.

## Updating the app

- Work on a branch, open a pull request, merge to `main`. Vercel builds and
  deploys `main` to production; migrations run in the build.
- After a schema change in `src/server/db/schema/`, run `npm run db:generate`
  and commit the new file in `drizzle/`. Update `SCHEMA_TAG` in
  `src/server/export/backup.ts` to the new migration's name (a unit test
  fails until you do), so exports say which database they came from.
- **Preview deployments.** Vercel builds every branch. Give Preview its own
  database (a Neon branch; Neon's Vercel integration can make one per
  preview) or none at all, so a preview never migrates or writes to her real
  data. Do not give Preview the production `BLOB_READ_WRITE_TOKEN` either.
- Rolling back: Vercel › Deployments › an earlier one › Promote. A rollback
  does not undo a migration; migrations here only add, so the older code
  keeps working on the newer database.

## Scheduled work

| Route | When (Istanbul time) | What it does |
| --- | --- | --- |
| `/api/cron/tick` | Every 15 minutes, 07:00 to 22:45 | Queues what is due (the day's summary at 08:00, the Friday review at 16:00, the monthly partner check, reminders, saved instructions on a schedule) and works through the job queue. |
| `/api/cron/nightly` | 04:00 | Empties trash older than 30 days, clears old job and notification records, finishes leftover jobs. |

Work queued during the day (reading an upload, classifying it, embeddings)
starts right after the request that queued it; the tick only picks up what a
stopped function left. A closed project runs nothing on a schedule.

## AI costs

- Ayarlar › Yapay zekâ shows this month's spend by helper, the cap, and the
  model each helper uses. Haiku does the frequent small jobs; reports and
  the assistant use larger models. She can switch AI off entirely there.
- Files marked "Yapay zekâya kapalı" (or inside such a folder) and files the
  child-data check holds are never sent to Claude or Voyage.
- Classification of many files at once goes through the Batch API, which
  costs half.
- Check the Anthropic Console's usage page now and then; it should match the
  app's own figure closely.

## Backups and restoring

Three layers, from quickest to most independent:

1. **Neon history.** Neon can restore the database to an earlier moment
   (Neon console › Backup & Restore). How far back depends on the Neon plan.
   Use it after a mistake in the data, such as a bad migration.
2. **Files.** Blob objects are not versioned. A file she deletes goes to the
   app's trash for 30 days; after that it is gone from the store.
3. **The export.** Ayarlar › Veri › Dışa aktar downloads one ZIP with
   everything: files in their folders, pages and meetings as Word and
   Markdown, Excel workbooks, an offline index page and a data file the app
   can restore. Large projects come in parts of about 1 GB. Suggest she
   downloads one every month and keeps it where her organisation's data rules
   allow.

**Restoring into a new installation** (a new Neon database, or a new Vercel
project after losing the old one):

1. Deploy as in "First deployment". The Blob store can be the old one (files
   already there are reused, not uploaded again) or a new one.
2. She signs in through `/setup` (a new passkey and new recovery codes).
3. Ayarlar › Veri › Yedekten geri yükle: choose the ZIP, or all its parts
   together. The browser reads the ZIP and sends files and records in small
   steps; keep the tab open. If it stops, choose the same ZIPs again; it
   starts over cleanly.

Restore opens only on an empty workspace, so it can never overwrite her
data. Passkeys, sign-ins and phone notifications are not in a backup; she
sets them up again.

## Closing the project

At the end, Ayarlar › Veri › Projeyi kapat lists what is still open, offers
the archive download, then makes the workspace read-only. Reading, search,
asking Claude and export keep working; nothing runs on a schedule. It can be
reopened from the same place. Once the archive is handed over and she no
longer needs the app, the Vercel project, the Neon project and the Blob
store can be deleted; keep the export ZIP(s).

## Troubleshooting

| What happens | Look at |
| --- | --- |
| Upload fails with "Dosya deposu henüz bağlı değil" | `BLOB_READ_WRITE_TOKEN` missing in Production, or the store is not connected. |
| Her passkey is refused | Was `APP_ORIGIN` or the domain changed? Passkeys belong to one host name. She signs in with a recovery code, then adds a passkey in Ayarlar › Hesap. |
| She lost every passkey and every recovery code | In the Neon SQL editor run `DELETE FROM sessions; DELETE FROM passkeys; DELETE FROM recovery_codes; DELETE FROM users;`. No project table points at the user, so her data stays. `/setup` opens again with the setup token. |
| No daily summary or reminders | Vercel › Settings › Cron Jobs: are the two jobs there and green? Is `CRON_SECRET` set? Is the project closed (Ayarlar › Veri)? |
| Phone notifications stopped | `APP_ORIGIN` must be the address she uses. On an iPhone the app must be added to the home screen. Ayarlar › Bildirimler › "Deneme bildirimi gönder" tests the whole path. |
| AI features answer "limit reached" or disappear | Ayarlar › Yapay zekâ: the cap, the switch, and whether the key is set. |
| A big export download stops | Each part must finish in 800 seconds; that needs Fluid compute (`"fluid": true` in `vercel.json`). On a slow connection, the parts are smaller downloads. |
| Search does not find words inside a file | The file may still be being read (its page shows the state), it may be a scan Claude could not read, or it may be marked "Yapay zekâya kapalı" (still searched by words, never by meaning). |
| Errors after a deployment | Vercel › the deployment › Logs (runtime errors). A failed build shows its log there too; migration errors appear at the top of it. |
| Laptop: a style change does not show in `npm run dev` | Stop the dev server, delete `.next/dev`, start again. |

## Working on the code

- `npm install`, then `npm run dev`. On a laptop the database is PGlite (a
  Postgres in a folder, migrated on start) and files go to a local folder; no
  cloud account is needed. With `E2E_LOGIN=1`, `POST /api/test/login` signs
  in without a passkey (refused in production).
- Checks: `npm run typecheck`, `npm run lint`, `npm test` (unit tests,
  including a full export and restore round trip and both languages having
  every message), `npm run test:e2e` (Playwright on a laptop and a phone
  screen, with an accessibility check of every screen in both themes).
  The browser tests start their own dev server on an empty workspace in a
  temporary folder, so stop `npm run dev` first; the first time, run
  `npx playwright install chromium`.
- GitHub Actions (`.github/workflows/ci.yml`) runs all of these, and a
  production build, on every pull request and on `main`. On a private
  repository a run uses about ten minutes of the account's Actions minutes.
- Map of the code:
  - `src/app/`: pages and API routes. Each screen's server actions sit
    beside it in `actions.ts`.
  - `src/server/`: everything that runs only on the server. `services/`
    holds the data rules, `ai/` the Claude helpers, `export/` the export and
    restore, `jobs/` the queue and schedule, `db/schema/` the tables.
  - `src/components/`: the screens, by area; `ui/` holds the shared pieces
    (buttons, dialogs) in the black-and-white Peni style.
  - `messages/tr` and `messages/en`: every word on screen, in both
    languages. Turkish uses "sen".
- Rules the code keeps:
  - Every server action goes through `act()` in `src/server/action.ts`,
    which checks the session and blocks changes when the project is closed.
  - Claude never changes her data. AI results become suggestions she
    approves.
  - Text inside uploaded files is data, never instructions to Claude.
  - No data about individual children: the guard in
    `src/server/files/child-guard.ts` checks uploads, imports and anything
    sent to Claude.

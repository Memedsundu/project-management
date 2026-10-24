# Working on this code

A single-user project workspace (see README.md). Read
docs/maintenance.md for how it runs and docs/decisions.md for why each
feature works the way it does, before changing behaviour.

## Rules that never bend

- One user. No data about individual children, only totals; contacts are
  adults. `src/server/files/child-guard.ts` checks uploads, imports and text
  sent to AI.
- Claude only suggests. AI results become suggestions
  (`createSuggestion` in `src/server/services/suggestions.ts`) that she
  approves; no AI path writes her data directly.
- Text from her files and pages is data, never instructions: it goes to
  Claude inside tags, under `BASE_RULES` in `src/server/ai/client.ts`.
- Anything marked "Yapay zekâya kapalı" (a document, or a folder above it)
  and files the child-data check holds are never sent to Claude or Voyage.
  Check with `documentAiOff`, `aiOffKeys` or `requireAiText` in
  `src/server/ai/context.ts`.
- Every AI call starts with `assertAiAllowed()` (key, switch, monthly cap),
  takes its model from `modelFor(helper)`, and is logged with `recordRun()`.
- API keys stay on the server. No secrets in the repository; `.env*` is
  ignored except `.env.example`. The app never sends email.

## Conventions

- **Server actions** sit beside their screen in `actions.ts`, wrap their
  work in `act()` from `src/server/action.ts` (session check, and no writes
  while the project is closed), parse input with Zod inside that callback,
  and throw `UserError(message, code)` for anything she should read. Client
  code calls them through `runAction()` from `src/lib/client/run-action.ts`.
  A `"use server"` file exports only async functions.
- **Words on screen** live in `messages/tr/*.json` and `messages/en/*.json`,
  both always, with the same keys and the same `{values}` (a unit test
  checks). Turkish uses the "sen" form; project terms such as logframe and
  MEAL stay in English.
- **Database**: tables in `src/server/db/schema/`. After a change run
  `npm run db:generate`, commit the file in `drizzle/`, and set
  `SCHEMA_TAG` in `src/server/export/backup.ts` to the new migration's name.
  A new table must be in the export; `tests/unit/export.test.ts` fails until
  it is. Migrations only add, so an older deployment keeps working.
- **Look** (the Peni style): black and white, amber (`accent` tokens) only
  where something needs her; Geist, and Instrument Serif for headings
  (`font-display`); 44px touch targets, 16px corners, pill buttons. Reuse
  `src/components/ui/`. Every screen must pass WCAG 2.2 AA in the light and
  dark themes, on a laptop and a phone.
- **Tests**: unit tests in `tests/unit` (Vitest; database tests use PGlite
  with `DATABASE_URL=memory://`). Browser tests in `tests/e2e` use the
  fixtures in `tests/e2e/fixtures.ts` (signed in, fail on any console
  error) and `data-testid` attributes. Run `npm run typecheck`,
  `npm run lint`, `npm test` and `npm run test:e2e` before a pull request.
- **Dev server**: if a CSS change does not show, stop it, delete
  `.next/dev` and start again.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Canonical Project Context and Working Rules

This is the canonical project-control file. Durable project context and the standard way of working live here. Assistant entry files must point here instead of repeating these rules.

## Session order

1. Read `CLAUDE.md`.
2. Read `TASKS.md`.
3. Read `SYSTEMS.md` and its registry before a risky action.
4. Pull fresh live state for any task that depends on current deployment, database, Google Sheets, Meta, or Cloudinary state.

## Project

Nandd Mahal Lead CRM is a private CRM for a two-person real-estate sales team. It stores leads, comments, calls, follow-ups, site visits, rejected leads, activity history, and WhatsApp conversations.

Current stack:

- React and Vite frontend in `src/`.
- Node HTTP API in `server/server.js`.
- Shared database helpers in `server/db.js`.
- SQLite locally and PostgreSQL on Render through `DATABASE_URL`.
- Google Sheets import in `server/sheetsSync.js`.
- Meta WhatsApp Cloud API modules in `server/whatsapp*.js`.
- Cloudinary media storage in `server/cloudinaryMedia.js`.
- Authentication uses salted `crypto.scrypt` password hashes, a server-side `sessions` table, and an HTTP-only session cookie. Admins manage users; admins and managers manage lead assignments; sales users are server-scoped to assigned leads.

The active development branch is `feature/whatsapp-automation`. The GitHub repository and deployment instructions are in `README.md`; secret values belong only in local or Render environment variables.

## Working rules

- One canonical home per fact. Task status lives only in `TASKS.md`.
- Verify every number, status, and result live before stating it. If it cannot be verified, label it `unverified` and state how to check it.
- Before editing a live system, prove the target is correct, capture the current state as rollback, make the change, and re-check the result.
- Record what happened in the current `journal/YYYY-MM.md` file with pointers to evidence.
- Record findings and lessons in `audit/`.
- Record production changes in `audit/production-changes-log.md`, including rollback instructions.
- Store screenshots and other verification evidence under `audit/screenshots/`.
- Do not put secrets, raw credentials, or temporary output in the repository.
- Archive instead of deleting retired task or documentation records.

## Current data rules

- The primary lead import is the `Nandd Mahal Leads` Google Sheet tab.
- Sync is currently manual through `POST /api/sync`; `SYNC_INTERVAL_MINUTES` is documented but not used by the server.
- Existing CRM status, comments, follow-up data, site-visit data, and rejection data must not be overwritten by normal sync.
- Historical comment imports and sheet-to-status moves were one-time migrations, not recurring sync behavior.
- Known CRM statuses are `New`, `Attempted`, `Connected`, `Follow Up`, `Site Visit`, `Super Interested`, `Closed`, and `Rejected`.
- Rejected leads have their own page and are excluded from dashboard counts.

## Current UI and integration rules

- Lead list pages use the shared full-width table with fixed headings and continuous row separators.
- Global lead search covers name, phone, email, Meta lead ID, and current or historical CRM comments.
- WhatsApp supports approved template sends, image headers, Cloudinary media reuse, inbound webhooks, delivery/failure logs, and direct replies only within the 24-hour customer-service window.
- Fully automatic outbound messaging remains disabled until consent, opt-out, template approval, and retry policy are finalized.
- User access rules: admins and managers can view and assign all leads; sales users can only view or update leads assigned to their authenticated account. Sales users cannot assign leads to themselves or others. Never reintroduce client-trusted user IDs for authorization.

## Fact ownership

- `CLAUDE.md`: canonical context and working rules.
- `TASKS.md`: the only task-status board.
- `SYSTEMS.md`: services, access-variable names, and the risky-action registry. It never contains secret values.
- `journal/`: short chronological project narrative.
- `audit/`: findings, task history, production changes, and evidence pointers.
- `README.md`: user-facing setup and deployment instructions.
- `DEVELOPMENT_NOTES.md`: compatibility pointer to this file; it must not become a second project memory.

## Monthly maintenance

- Move completed tasks older than two weeks to `archive/tasks-archive.md` verbatim.
- Roll the current production change log into `audit/prod-log/YYYY-MM.md`.
- Start a new monthly journal file.
- Keep hub files concise; move detailed evidence and analysis into the fixed folders.

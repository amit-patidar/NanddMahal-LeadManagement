# Repository review, 2026-10-19

Scope: local source, complete fetched commit history, project records, and a live read of GitHub HEAD. No production service, database, Google Sheet, Meta account, or Cloudinary configuration was inspected or changed.

## Git evidence

- Local `main`, `origin/main`, and live GitHub HEAD matched `4b648eb506fb1c7adc839098e96fa817b6609825`. The working tree was clean before this review record.
- Latest commit `4b648eb` (2026-09-20) updates a filter QA screenshot only. Latest application change is `29b405b` on the same date: saved Google Sheet mappings and shared table filters.
- Manual entry was merged through `6e57c2e` on 2026-08-26. WhatsApp and secure CRM workflows were merged through `eae18bb` on 2026-08-21.

## Source observations

- `src/main.jsx` contains the app shell, login, user management, lead workflows, shared tables, detail view, and WhatsApp drawer. `src/SyncPanel.jsx` isolates the mapping editor.
- `server/server.js` uses native Node HTTP routing and serves the built frontend. Authentication and lead access are enforced before protected operations. Database startup creates/migrates tables; importing this module starts the service.
- `server/db.js` provides SQLite/PostgreSQL access, source import/enrichment, transactional manual creation, activity history, and WhatsApp persistence. Google Sheet sync inserts new stable IDs and fills missing source values while preserving CRM-managed fields and the latest comment.
- Mapping preview/save are separate from import. Saved mappings are scoped to spreadsheet/numeric tab ID and checked for source/revision conflicts.
- The lead list API limits results to 300 records. Looking For and Buy Plan dropdowns filter the returned rows in the browser; their options represent that loaded subset.
- Missed leads are calculated from activity age and scheduling fields. Messaging uses approved templates, webhook processing, and server-enforced 24-hour direct replies. No automatic outbound rollout was established by this review.

## Documentation discrepancies

- `CLAUDE.md` names `feature/sheet-column-mapping` as active, but this checkout is on `main`; the fetched remote has no branch with that name.
- `README.md` and T-003's merge prerequisite describe WhatsApp as awaiting merge, although `eae18bb` already merged it. Remaining rollout/QA work must be distinguished from merge history.
- T-011/T-012 histories say no commit or push was performed during their recorded session; those changes are now present in GitHub main. These statements should be read as historical session boundaries.
- Existing drawer evidence records automated checks but leaves manual browser QA open. No new QA result or task completion is asserted here. Task status remains exclusively in `TASKS.md`.

## Verification limits

Node and npm were unavailable on the current shell PATH; Node was also absent from `C:/Program Files/nodejs/node.exe`. No builds or test suites were rerun. Historical test results remain historical evidence, not current verification. Deployment, live data, integration credentials, and GitHub push permission remain unverified.

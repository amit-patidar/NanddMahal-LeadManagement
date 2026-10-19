# Tools

- `npm run verify:sheet-sources` checks multi-source persistence, existing-source adoption, source validation, per-tab mappings, global lead identity, protected CRM data, partial sync, disabling, concurrent sync rejection, and admin-only APIs using temporary SQLite and mocked Google responses.
- `node tools/verify-sheet-sources-ui.js` checks source management and mapping isolation in desktop/mobile Chrome against a fixture API. Requires a built frontend and Playwright (or `PLAYWRIGHT_MODULE`). Evidence is saved under `audit/screenshots/T-013-*`.

- `npm run verify:manual-leads` runs isolated API checks for direct lead creation, role-safe assignment, duplicate protection, validation, and activity history.
- `npm run verify:sheet-mapping` checks mapping, preview, persistence, admin authorization, and sync behavior with an isolated database and mocked Google Sheets responses.
- `npm run verify:lead-column-filters` checks the separate Looking For and Buy Plan header dropdowns, unique options, combined filtering, date reset, every lead-list route/tab, and responsive layout. It accepts the optional `PLAYWRIGHT_MODULE` used by the mapping UI verifier.
- `node tools/verify-sheet-mapping-ui.js` runs desktop/mobile UI checks against a built frontend and fixture API. Requires Playwright and Chrome; optionally set `PLAYWRIGHT_MODULE` to an installed Playwright module URL. Screenshots are stored under `audit/screenshots/T-011-*`.
- After `npm run build`, `node tools/preview-sheet-mapping.js` starts a disposable local demo at port 5183 (override with `PREVIEW_PORT`). Login: `demo@example.com` / `MappingDemo123!`. Its sheet and database are test fixtures; it never loads `.env`.
  The initial fixture is `demo-sheet` / `Demo Leads`. Connect `demo-campaign` / `Campaign Leads` to try multiple sources; it contains additional sample leads and one shared ID to demonstrate duplicate protection. Restarting the demo creates a fresh temporary database.

Store maintained project scripts here. Temporary scripts and scratch output belong outside the repository.

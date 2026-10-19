# Production Changes Log

## 2026-10-19: Multi-sheet release

- Authorized target: `amit-patidar/NanddMahal-LeadManagement`, branch `main`; public production app `https://nanddmahal-leadmanagement.onrender.com` from README. User explicitly requested pushing main for live testing.
- Before push: local and live GitHub main matched `4b648eb506fb1c7adc839098e96fa817b6609825`. Public app root returned HTTP 200, health returned `{"ok":true}`, and its JavaScript asset was `/assets/index-DCHlHoMz.js`. No Render dashboard/deploy ID or production database credentials were available for inspection.
- Prepared change: multiple source settings, per-tab mapping, and aggregate manual sync, with the build/API/browser verification recorded in `audit/task-history/T-013.md`. Startup adds `sheet_sync_sources` and adopts the legacy environment source; it does not import leads. No secrets or environment-variable changes are included.
- Rollback reference: the pre-release main commit above. Redeploy that commit or revert this feature commit through normal Git history. Leave additive source/mapping tables intact. Older code resumes the environment-configured single source. Existing imported leads are retained; any later lead-data restoration requires a separate verified backup.
- Push: feature commit `84a6f1d94043d1ad13c5883c4e524b62e26fddea` was pushed to `origin/main`; a subsequent live GitHub ref read confirmed that exact commit.
- Deployment verification: production automatically switched from `/assets/index-DCHlHoMz.js` to `/assets/index-DiWrajwn.js`, matching the tested local build. The new public asset contains the multi-sheet controls, and `/api/health` returned `{"ok":true}` afterward. The prior public JavaScript asset's SHA-256 was `09051a19286a5fb284d13dd251d743ef13ce8c859d3747783fccd6a943eabce6`; its snapshot was kept outside the repository in the local temporary directory.
- Scope of live verification: public build and health only. No production sheet connection, sync, mapping save, credential change, or authenticated data access was performed. Render build logs/deploy ID and authenticated mapping/import behavior remain unverified.

No production system was changed by the project-control bootstrap on 2026-08-17. The change only adds repository documentation and tracking structure.

For a future live change, record the target, current state, commit or configuration reference, verification result, and rollback steps here before closing the task.

## 2026-08-20

- Target: Render PostgreSQL production database used by the lead CRM.
- Change: Updated `users.id = 2` for `Ksengar413@gmail.com` from role `sales` to role `admin`; the account remains active.
- Method: One-time parameterized transaction against the exact email and user ID. No application code or schema change was made.
- Verification: A post-commit query returned `role = admin`, `active = true` for the same user.
- Rollback: Run `UPDATE users SET role = 'sales' WHERE id = 2 AND LOWER(email) = LOWER('ksengar413@gmail.com') AND role = 'admin';` against the same production database, then verify the returned role.

## 2026-08-21

- Target: Render feature service at `https://nanddmahal-leadmanagement-1.onrender.com` and its configured PostgreSQL database/Google worksheet.
- Prior state: 259 live leads; 259 had `looking_for`, while 247 had `buy_plan`. A source-field snapshot of all 259 leads was saved outside the repository under the local temporary backup directory with SHA-256 `29e1ac700c5e5fb2a933eacc18bfcacde8feecba905fb38004afc1bec73da3f0`.
- Change: Ran the authenticated manual Google Sheet sync. It created 0 leads and filled missing source fields on 12 existing leads; verification showed all 12 changes were to `buy_plan`, with no `looking_for` changes.
- Verification: Lead count remained 259. All 259 leads had nonblank `looking_for` and `buy_plan`. A second sync created 0, updated 0, and skipped all 12 current-sheet records.
- Rollback: Compare the temporary pre-sync snapshot with the same live lead IDs and restore only differing `buy_plan` values using a parameterized transaction. Re-check all 259 source fields before committing; do not restore after newer legitimate edits without taking another backup.

# Production Changes Log

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

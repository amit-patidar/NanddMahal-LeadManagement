# Production Changes Log

No production system was changed by the project-control bootstrap on 2026-08-17. The change only adds repository documentation and tracking structure.

For a future live change, record the target, current state, commit or configuration reference, verification result, and rollback steps here before closing the task.

## 2026-08-20

- Target: Render PostgreSQL production database used by the lead CRM.
- Change: Updated `users.id = 2` for `Ksengar413@gmail.com` from role `sales` to role `admin`; the account remains active.
- Method: One-time parameterized transaction against the exact email and user ID. No application code or schema change was made.
- Verification: A post-commit query returned `role = admin`, `active = true` for the same user.
- Rollback: Run `UPDATE users SET role = 'sales' WHERE id = 2 AND LOWER(email) = LOWER('ksengar413@gmail.com') AND role = 'admin';` against the same production database, then verify the returned role.

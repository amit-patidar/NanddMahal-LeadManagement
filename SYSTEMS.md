# Systems and Access Registry

This file lists systems, environment-variable names, and the registry for risky work. It must never contain secret values, private keys, database passwords, access tokens, or service-account JSON.

## Systems

| System | Purpose | Configuration location |
| --- | --- | --- |
| Local SQLite | Local development database | `DATABASE_PATH` in local `.env` |
| Render PostgreSQL | Shared deployed database | `DATABASE_URL` in Render environment variables |
| Google Sheets | Lead import source | `GOOGLE_SHEET_ID`, `GOOGLE_WORKSHEET_NAME`, and Google service-account variables |
| Meta WhatsApp Cloud API | WhatsApp templates, messages, and webhooks | `WHATSAPP_*` variables in Render environment variables |
| Cloudinary | Reusable WhatsApp header images | `CLOUDINARY_*` variables in Render environment variables |
| GitHub | Source repository and deployment trigger | Repository URL in `README.md` |
| Render | Web service and PostgreSQL hosting | Render dashboard; verify live state before deployment changes |

## Registry

| Risk area | Read before acting | Verify before and after | Rollback record |
| --- | --- | --- | --- |
| Database or data migration | `CLAUDE.md` data rules and `audit/` findings | Database target, row counts, and backup/export | `audit/production-changes-log.md` and task history |
| Google Sheets sync | `CLAUDE.md` data rules and `server/sheetsSync.js` | Sheet ID, tab name, service-account access, import result | Record prior configuration and rerun-safe behavior |
| Render deployment | `README.md` deployment section and `CLAUDE.md` live-edit rule | Branch, build logs, health URL, and environment variables | Record commit, previous deploy, and reversal steps |
| WhatsApp or Meta changes | `README.md` WhatsApp section and `server/whatsapp*.js` | Callback verification, provider response, webhook delivery, and message status | Record environment/config change and previous values without secrets |
| Authentication or security | `CLAUDE.md` security rules and relevant audit finding | Access scope, credential handling, and login behavior | Revert only the scoped change and rotate exposed credentials |

## Environment variable names

Only names are recorded here. Values belong in local `.env` or Render settings:

`DATABASE_URL`, `DATABASE_PATH`, `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `COOKIE_SECURE`, `GOOGLE_SHEET_ID`, `GOOGLE_WORKSHEET_NAME`, `GOOGLE_PROJECT_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `WHATSAPP_PROVIDER`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_API_VERSION`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_WHATSAPP_FOLDER`.

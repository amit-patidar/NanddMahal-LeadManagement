# Development Notes

This file is the project memory for the Nandd Mahal Lead CRM. Read it before adding new features so current behavior is not accidentally changed.

## Current Goal

Private CRM for a two-person real-estate sales team. The app receives leads from Google Sheet sync, stores them in the CRM database, and lets the team manage calling, comments, follow-ups, site visits, super interested leads, rejected leads, and activity history.

## Tech Stack

- Frontend: Vite + React in `src/main.jsx`
- Styling: `src/styles.css`
- Backend: Node HTTP server in `server/server.js`
- Database layer: `server/db.js`
- Google Sheet sync: `server/sheetsSync.js`
- Local DB: SQLite file `crm.sqlite`
- Production DB: Render PostgreSQL using `DATABASE_URL`
- Hosting: Render Free Web Service
- GitHub repo: `https://github.com/amit-patidar/NanddMahal-LeadManagement.git`

## Deployment Model

Render is connected to GitHub. Pushing to `main` triggers Render build/deploy if Auto Deploy is enabled.

Render commands:

- Build: `npm run render-build`
- Start: `npm start`

Secrets are not stored in Git. Configure these in Render environment variables:

- `DATABASE_URL`
- `GOOGLE_SHEET_ID`
- `GOOGLE_WORKSHEET_NAME`
- `GOOGLE_PROJECT_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Use `DATABASE_PATH` only locally for SQLite. Do not set `DATABASE_PATH` on Render.

## Important Security Notes

- `.env`, `crm.sqlite`, `crm-export.json`, and Google service account JSON files must stay out of Git.
- The app currently stores passwords as plain text in the database. Do not expand auth features before deciding whether to add password hashing.
- If service account keys or database URLs are pasted into chat or screenshots, rotate them later.

## Data Source

Primary import source is Google Sheet tab:

- `Nandd Mahal Leads`

Manual sync button calls:

- `POST /api/sync`

Current code does not auto-sync. `SYNC_INTERVAL_MINUTES` exists in env files but is not used by the server yet.

Expected sheet columns and mappings:

- `id` / `Lead ID` / `Meta Lead ID` -> `meta_lead_id`
- `created_time` / `Created Time` -> `meta_created_at`
- `full_name` / `Name` -> `name`
- `phone_number` / `Phone` -> `phone`
- `email` -> `email`
- `campaign_name` -> `campaign`
- `what_are_you_looking_for?` -> `looking_for`
- `when_are_you_planning_to_buy?` -> `buy_plan`

Sync behavior:

- New `meta_lead_id` creates a lead.
- Existing `meta_lead_id` does not create duplicates.
- Existing CRM status, comments, follow-up dates, site visit dates, and rejection info are preserved.
- Existing leads may be updated only for missing basic fields like name, phone, email, campaign, looking for, buy plan, or meta created date.
- A skipped row usually means either missing `meta_lead_id` or the lead already exists and has no missing fields.

## One-Time Historical Work Already Done

These were one-time migrations and should not be added as recurring sync behavior unless explicitly requested:

- Imported existing Google Sheet leads into CRM.
- Imported historical comments from `Followup needed` and `Intersted in Visit`.
- Moved leads by sheet into CRM status:
  - `Followup needed` -> `Follow Up`
  - `Intersted in Visit` -> `Site Visit`
  - `Super Intersted` -> `Super Interested`
  - `Rejected Leads` -> `Rejected`
- Imported `Comment 1` and `Comment 2` from `Nandd Mahal Leads` only for New leads, without touching Follow-up or Site Visit leads.

## CRM Statuses

Known statuses:

- `New`
- `Attempted`
- `Connected`
- `Follow Up`
- `Site Visit`
- `Super Interested`
- `Closed`
- `Rejected`

Rejected leads are shown in their own sidebar section and should not be included in dashboard counts.

## Main UI Pages

Sidebar pages:

- Dashboard
- New Leads
- Follow-ups
- Site Visits
- Super Interested
- Missed
- Rejected Leads
- All Leads

All lead list pages should use the shared table style and fixed headings. Campaign and Next columns were intentionally removed from the frontend table.

Current known improvement planned:

- Complete WhatsApp automation rollout from `feature/whatsapp-automation`.

## UI Decisions

- Use full available page width for lead tables.
- Keep global lead search visible above pages. It searches name, phone, email, and Meta lead ID and opens lead detail directly.
- Keep rows table-like, not card-heavy.
- Keep row separator lines continuous across columns.
- Keep action buttons compact.
- Rejected page may show rejection reason; dashboard should not count rejected leads.

## Useful Commands

Run locally:

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
```

Export local SQLite data:

```bash
npm run export:data
```

Import `crm-export.json` into PostgreSQL:

```bash
npm run import:data
```

Check Git status:

```bash
git status --short --branch
```

## Future Feature Guidelines

- Prefer extending existing helpers in `server/db.js` and shared frontend components in `src/main.jsx`.
- Do not overwrite manual CRM work during sync.
- Do not add recurring Google Sheet sync without considering quota and Render Free limits. Prefer 5 or 10 minutes if auto-sync is added.
- Direct Meta integration can be added later through webhook endpoints, but keep Google Sheet sync as backup during transition.
- Before making deployment-related changes, check Render env variables and avoid committing secrets.

## WhatsApp Automation Branch

Work branch:

- `feature/whatsapp-automation`

Planned provider:

- Meta WhatsApp Cloud API first.

Callback URL:

```text
https://nanddmahal-leadmanagement.onrender.com/api/webhooks/whatsapp/meta
```

Required Render env vars:

- `WHATSAPP_PROVIDER=meta`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_API_VERSION`
- `WHATSAPP_WEBHOOK_REQUIRE_SIGNATURE=true`

Implementation notes:

- `GET /api/webhooks/whatsapp/meta` verifies Meta webhook setup by returning `hub.challenge`.
- `POST /api/webhooks/whatsapp/meta` receives inbound messages and delivery/read/failed status events.
- Webhook POST verification uses Meta `X-Hub-Signature-256` and the raw request body.
- WhatsApp events are stored separately and important events are also added to `lead_activities`.
- Inbound messages are matched to CRM leads by normalized phone number.
- Manual template sending is available from lead detail only when Render WhatsApp send env vars are configured.
- Approved templates are loaded from Meta through `GET /api/whatsapp/templates` and cached briefly in memory. Use `POST /api/whatsapp/templates/refresh` to bypass cache.
- For templates with image headers, the CRM sends a Meta `header` image component from the Header Image URL field.
- Direct/free-text replies are available from lead detail only when the backend finds an inbound WhatsApp message for that lead inside the last 24 hours.
- WhatsApp failed messages show inline reason, provider error code, failed time, and expandable details from the stored webhook payload.
- The WhatsApp panel refresh button reloads only lead-specific WhatsApp messages and reply-window status, not the whole lead page.
- Do not enable fully automatic outbound messages until consent, opt-out, template approval, and retry policy are finalized.

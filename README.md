# Nandd Mahal Lead CRM

Simple private CRM for a two-person real-estate sales team. It keeps Meta leads, follow-ups, site visits, comments, and activity history in one web app.

Before making feature changes, read `AGENTS.md`, then `CLAUDE.md`, `TASKS.md`, and `SYSTEMS.md`. `README.md` contains user-facing setup and deployment instructions.

## Run Locally

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The API runs on `http://localhost:4000`.

If the database is empty, create the first administrator through these local `.env` values before starting the server:

```bash
INITIAL_ADMIN_NAME=CRM Admin
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=<at least 8 characters>
COOKIE_SECURE=false
```

Existing legacy users are migrated to salted password hashes on startup. Passwords are environment/database data and should not be committed.

After login, an administrator can open **Users** to create sales, manager, or admin accounts, reset passwords, and activate/deactivate users. Administrators and managers can assign leads from the **Assign Lead** user list in lead tables or lead detail. Sales users only see leads assigned to their account and cannot assign leads.

Every lead table includes unique-value dropdowns in the Looking For and Buy Plan column headings. They are available on New Leads, Follow-ups, Site Visits, Super Interested, every Missed tab, Rejected Leads, and All Leads. The two filters work independently or together and reset when the page or date view changes.

## Google Sheets Sync

Copy `.env.example` to `.env` later and fill:

```bash
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_WORKSHEET_NAME=Nandd Mahal Leads
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
```

The manual **Sync Leads** button imports from all enabled sheet sources. New Meta Lead IDs create leads; existing leads can have blank source fields filled. Existing CRM status, comments, assignments, follow-ups, rejected status, and site visits are never overwritten by sync.

### Multiple sheet sources

Administrators can open **Sheet sources & column mapping** below **Sync Leads** on the dashboard. Enter a source name, Google Sheets URL or spreadsheet ID, and the tab name, then select **Connect sheet**. A URL containing `gid` can select the tab without a name; an entered tab name takes precedence. Multiple tabs from one spreadsheet and tabs from different spreadsheets are supported. Share every spreadsheet with the same configured Google service account before connecting it.

Connecting verifies access and reads sample rows without importing leads. Use **Map** beside a source to review its own column mapping. Each source can be disabled or enabled; disabling it retains imported leads and mapping settings. Sync reports per-source counts and errors, continuing with other sources if one fails. A running sync uses the enabled-source list captured at its start.

Lead IDs remain global across all sources: the same ID refers to the same CRM lead, even when it appears in multiple sheets. Use stable, globally unique IDs for different leads. Existing populated source values are preserved; enabled sources are processed in creation order (then source ID), and the first available value fills a blank field.

Sources are stored in the existing application database in the additive `sheet_sync_sources` table. The previous environment-configured source is adopted once at startup without importing any leads. Its numeric tab ID is pinned on its first successful read; newly connected tabs are pinned immediately, so later tab renames retain the same mapping. After adoption, manage sources in the CRM; changing the legacy environment variables does not replace the saved source. Credentials remain in environment variables. A fresh deployment without `GOOGLE_SHEET_ID` can connect its first source through the CRM once Google credentials are configured.

Expected sheet columns can use common names such as:

- Meta Lead ID / Lead ID
- Created Time
- Name / Full Name
- Phone / Mobile
- Email
- Campaign / Project
- `which_property_price_range_are_you_interested_in_exploring?` mapped to `looking_for` (the CRM's Looking For field now stores budget/price range)
- `when_you_are_planning_to_buy?` mapped to `buy_plan`

The previous `what_are_you_looking_for?` header remains accepted as a transition fallback. `Buy Plan` also accepts the previous `when_are_you_planning_to_buy?` spelling.

### Saved column mapping

Administrators can expand **Sheet sources & column mapping** below **Sync Leads** on the dashboard. Select **Map** beside a source, select a sheet column for each CRM source field, preview sample rows, and save. Saving does not import leads. Later syncs reuse that source's saved mapping; optional fields can be ignored, and automatic matching remains available.

Mappings are stored in the application database per spreadsheet and numeric tab ID, survive deployments, and are shared between admins. The required Lead ID must identify a lead consistently across imports. Changing its mapped column can change which records are treated as new. Reordering uniquely named columns is supported; renamed or missing mapped headers must be corrected before syncing. Existing populated source values are not bulk-overwritten by remapping.

To change sources, connect the new spreadsheet/tab in the CRM and disable the old source if it should stop importing. Review the new source's column mapping before syncing. Credentials stay in Render; no new environment variables are needed for additional sources.

The application creates the additive `sheet_column_mappings` settings table on startup, using the existing SQLite/PostgreSQL database. No lead-data migration is required. Do not remove this table when rolling back the application; older builds ignore it.

## Render Free Deployment

Use one Render Web Service plus one Render PostgreSQL database.

### 1. Export Local Data

Run this locally before importing into Render PostgreSQL:

```bash
npm run export:data
```

This creates `crm-export.json` locally. It contains lead data, so keep it private.

### 2. Render PostgreSQL

Create a free PostgreSQL database in Render. Copy its **Internal Database URL**.

### 3. Render Web Service

Create a Web Service from the project repository.

Build command:

```bash
npm run render-build
```

Start command:

```bash
npm start
```

Environment variables:

```bash
DATABASE_URL=<Render Internal Database URL>
INITIAL_ADMIN_NAME=<first administrator name, only needed for an empty database>
INITIAL_ADMIN_EMAIL=<first administrator email, only needed for an empty database>
INITIAL_ADMIN_PASSWORD=<first administrator password, only needed for an empty database>
COOKIE_SECURE=true
GOOGLE_SHEET_ID=<sheet id>
GOOGLE_WORKSHEET_NAME=Nandd Mahal Leads
GOOGLE_PROJECT_ID=<service account project_id>
GOOGLE_CLIENT_EMAIL=<service account client_email>
GOOGLE_PRIVATE_KEY=<service account private_key>
```

For `GOOGLE_PRIVATE_KEY`, keep the full key including newline escapes. If Render changes line breaks, paste it with `\n` and the app will convert it.

Alternative:

```bash
GOOGLE_SERVICE_ACCOUNT_JSON=<full service account JSON>
```

Use either the three Google fields above or the full JSON field, not both.

### WhatsApp Webhook Setup

The WhatsApp automation work lives on the `feature/whatsapp-automation` branch until it is ready to merge.

Production Meta callback URL:

```text
https://nanddmahal-leadmanagement.onrender.com/api/webhooks/whatsapp/meta
```

Test branch callback URL:

```text
https://nanddmahal-leadmanagement-1.onrender.com/api/webhooks/whatsapp/meta
```

Render environment variables:

```bash
WHATSAPP_PROVIDER=meta
WHATSAPP_VERIFY_TOKEN=<secret verify token you create>
WHATSAPP_APP_SECRET=<Meta app secret>
WHATSAPP_ACCESS_TOKEN=<Meta WhatsApp access token>
WHATSAPP_PHONE_NUMBER_ID=<Meta WhatsApp phone number id>
WHATSAPP_BUSINESS_ACCOUNT_ID=<Meta WhatsApp business account id>
WHATSAPP_API_VERSION=v23.0
WHATSAPP_WEBHOOK_REQUIRE_SIGNATURE=true
```

The same callback route handles Meta verification with `GET` and incoming webhook events with `POST`.

The lead detail WhatsApp panel supports:

- Approved template sends for business-initiated messages.
- Approved-template dropdown loaded from Meta WhatsApp Manager.
- Image-header templates by entering a public HTTPS header image URL.
- Cloudinary-backed media library for reusable WhatsApp header images, including upload, refresh, saved-image dropdown, and preview.
- Direct/free-text replies only when the lead has an inbound WhatsApp message inside the 24-hour customer service window.
- Inline failed-message reasons and a WhatsApp-only message refresh button.

Cloudinary env vars for WhatsApp image uploads:

```bash
CLOUDINARY_CLOUD_NAME=<cloud name>
CLOUDINARY_API_KEY=<api key>
CLOUDINARY_API_SECRET=<api secret>
CLOUDINARY_WHATSAPP_FOLDER=nandd-mahal/whatsapp-headers
```

When Cloudinary is configured, the WhatsApp panel shows **Header Image Library** with **Upload Image** and **Refresh Images**. Uploaded files are stored in Cloudinary and their public URLs are saved in the CRM database for reuse. Keep WhatsApp header images under 6 MB.

### 4. Import Local Data Into Render PostgreSQL

After Render PostgreSQL is created, set your local `.env` temporarily with the Render `DATABASE_URL`, then run:

```bash
npm run import:data
```

This imports `crm-export.json` into PostgreSQL.

### 5. Custom Domain

In Render Web Service:

1. Open Settings.
2. Add Custom Domain.
3. Copy the DNS record Render gives you.
4. Add that record in your domain provider.
5. Wait for SSL to become active.

## Scope

Included:

- Dashboard counts
- New Leads, Follow-ups, Site Visits, Super Interested, Rejected Leads, Missed, All Leads
- Flexible status changes
- Follow-up and site visit scheduling
- Dynamic missed lead calculations
- Lead detail with permanent activity timeline
- Direct manual lead entry for side leads, with role-safe assignment and duplicate-phone protection
- WhatsApp webhook foundation, template send, and 24-hour direct replies on feature branch
- SQLite for local development and PostgreSQL for Render deployment

Not included in v1:

- Email marketing
- Finance/inventory
- Complex analytics
- Document management

# Nandd Mahal Lead CRM

Simple private CRM for a two-person real-estate sales team. It keeps Meta leads, follow-ups, site visits, comments, and activity history in one SQLite-backed web app.

## Run Locally

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The API runs on `http://localhost:4000`.

Sample users:

- `divyanshu@nandtmahal.local` / `123456`
- `amit@nandtmahal.local` / `123456`

## Google Sheets Sync

Copy `.env.example` to `.env` later and fill:

```bash
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_WORKSHEET_NAME=Nandd Mahal Leads
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
```

The manual **Sync Leads** button imports rows whose Meta Lead ID is not already present. Existing CRM status, comments, follow-ups, and site visits are never overwritten by sync.

Expected sheet columns can use common names such as:

- Meta Lead ID / Lead ID
- Created Time
- Name / Full Name
- Phone / Mobile
- Email
- Campaign / Project
- `what_are_you_looking_for?` mapped to `looking_for`
- `when_are_you_planning_to_buy?` mapped to `buy_plan`

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
- New Leads, Follow-ups, Site Visits, Super Interested, Missed, All Leads
- Flexible status changes
- Follow-up and site visit scheduling
- Dynamic missed lead calculations
- Lead detail with permanent activity timeline
- SQLite schema prepared for later PostgreSQL migration

Not included in v1:

- WhatsApp automation
- Email marketing
- Finance/inventory
- Complex analytics
- Document management

# Nandd Mahal Lead CRM

Simple private CRM for a two-person real-estate sales team. It keeps Meta leads, follow-ups, site visits, comments, and activity history in one web app.

See `DEVELOPMENT_NOTES.md` before making feature changes. It documents the current architecture, deployment, data rules, and known decisions.

## Run Locally

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The API runs on `http://localhost:4000`.

Users are seeded for local development if the database is empty:

- `amitpatidar.7492@gmail.com`
- `Ksengar413@gmail.com`

Passwords are environment/database data and should not be committed.

## Google Sheets Sync

Copy `.env.example` to `.env` later and fill:

```bash
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_WORKSHEET_NAME=Nandd Mahal Leads
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
```

The manual **Sync Leads** button imports rows whose Meta Lead ID is not already present. Existing CRM status, comments, follow-ups, rejected status, and site visits are never overwritten by sync.

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

### WhatsApp Webhook Setup

The WhatsApp automation work lives on the `feature/whatsapp-automation` branch until it is ready to merge.

Meta callback URL:

```text
https://nanddmahal-leadmanagement.onrender.com/api/webhooks/whatsapp/meta
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
- Cloudinary-backed media library for reusable WhatsApp header images.
- Direct/free-text replies only when the lead has an inbound WhatsApp message inside the 24-hour customer service window.
- Inline failed-message reasons and a WhatsApp-only message refresh button.

Cloudinary env vars:

```bash
CLOUDINARY_CLOUD_NAME=<cloud name>
CLOUDINARY_API_KEY=<api key>
CLOUDINARY_API_SECRET=<api secret>
CLOUDINARY_WHATSAPP_FOLDER=nandd-mahal/whatsapp-headers
```

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
- WhatsApp webhook foundation, template send, and 24-hour direct replies on feature branch
- SQLite for local development and PostgreSQL for Render deployment

Not included in v1:

- Email marketing
- Finance/inventory
- Complex analytics
- Document management

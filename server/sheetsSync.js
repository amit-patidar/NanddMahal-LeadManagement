import { google } from "googleapis";
import { createLeadFromSource } from "./db.js";

const headerAliases = {
  meta_lead_id: ["meta lead id", "lead id", "id", "meta_lead_id"],
  meta_created_at: ["created time", "created_time", "created_at", "meta creation date", "meta_created_at", "created date"],
  name: ["name", "full name", "full_name", "customer name"],
  phone: ["phone", "phone number", "phone_number", "mobile", "mobile number", "mobile_number"],
  email: ["email", "email address"],
  campaign: ["campaign", "project", "campaign name", "campaign_name", "ad name", "ad_name"],
  looking_for: ["what_are_you_looking_for?", "what are you looking for?", "looking for", "requirement", "property requirement", "looking_for"],
  buy_plan: ["when_are_you_planning_to_buy?", "when are you planning to buy?", "planning to buy", "buy plan", "buy timeline", "buy_plan"]
};

export async function syncGoogleSheet(userId = null) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const worksheetName = process.env.GOOGLE_WORKSHEET_NAME || "Nandd Mahal Leads";
  const authConfig = googleAuthConfig();

  if (!sheetId || !authConfig) {
    return {
      configured: false,
      created: 0,
      skipped: 0,
      message: "Google Sheets sync is not configured. Add GOOGLE_SHEET_ID and Google service account credentials."
    };
  }

  const auth = new google.auth.GoogleAuth(authConfig);
  const sheets = google.sheets({ version: "v4", auth });
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${worksheetName}'`
  });

  const rows = result.data.values || [];
  if (rows.length < 2) {
    return { configured: true, created: 0, skipped: 0, message: "No rows found in worksheet." };
  }

  const headers = rows[0].map((h) => String(h || "").trim().toLowerCase());
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const source = mapRow(headers, row);
    if (!source.meta_lead_id) {
      skipped += 1;
      continue;
    }
    const imported = await createLeadFromSource({ ...source, imported_from: "Google Sheet" }, userId);
    if (imported.created) created += 1;
    else if (imported.updated) updated += 1;
    else skipped += 1;
  }

  return { configured: true, created, updated, skipped, message: `Sync complete. Created ${created}, updated ${updated}, skipped ${skipped}.` };
}

function googleAuthConfig() {
  const scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes };
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    if (credentials.private_key) {
      credentials.private_key = normalizePrivateKey(credentials.private_key);
    }
    return { credentials, scopes };
  }

  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
        project_id: process.env.GOOGLE_PROJECT_ID
      },
      scopes
    };
  }

  return null;
}

function normalizePrivateKey(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\\\n/g, "\n")
    .replace(/\\n/g, "\n");
}

function mapRow(headers, row) {
  const source = {};
  for (const [field, aliases] of Object.entries(headerAliases)) {
    const index = headers.findIndex((h) => aliases.includes(h));
    source[field] = index >= 0 ? String(row[index] || "").trim() : "";
  }
  return source;
}

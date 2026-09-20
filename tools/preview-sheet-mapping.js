import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { google } from "googleapis";

// Disposable local demo: no .env, live sheet, or production database access.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mapping-preview-"));
Object.assign(process.env, {
  DATABASE_URL: "", DATABASE_PATH: path.join(directory, "preview.sqlite"),
  PORT: process.env.PREVIEW_PORT || "5183", COOKIE_SECURE: "false",
  INITIAL_ADMIN_NAME: "Demo Admin", INITIAL_ADMIN_EMAIL: "demo@example.com",
  INITIAL_ADMIN_PASSWORD: "MappingDemo123!",
  GOOGLE_SHEET_ID: "demo-sheet", GOOGLE_WORKSHEET_NAME: "Demo Leads",
  GOOGLE_APPLICATION_CREDENTIALS: "", GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
  GOOGLE_CLIENT_EMAIL: "", GOOGLE_PRIVATE_KEY: ""
});
const rows = [
  ["id", "full_name", "phone_number", "which_property_price_range_are_you_interested_in_exploring?", "when_you_are_planning_to_buy?"],
  ["demo-001", "Sample Buyer", "9000000001", "80 lakh", "Within 3 months"],
  ["demo-002", "Sample Visitor", "9000000002", "1 crore", "Immediately"]
];
google.sheets = () => ({ spreadsheets: {
  get: async () => ({ data: { properties: { locale: "en_IN" }, sheets: [{
    properties: { sheetId: 1, title: "Demo Leads" },
    data: [{ rowData: rows.map((row) => ({ values: row.map((formattedValue) => ({ formattedValue })) })) }]
  }] } }),
  values: { get: async () => ({ data: { values: rows } }) }
} });
const { server } = await import("../server/server.js");
const { db } = await import("../server/db.js");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  await fs.rm(directory, { recursive: true, force: true });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log("Demo login: demo@example.com / MappingDemo123!");

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
const fixtures = [
  { spreadsheetId: "demo-sheet", tabId: 1, title: "Demo Leads", rows },
  { spreadsheetId: "demo-campaign", tabId: 7, title: "Campaign Leads", rows: [
    ["Lead ID", "Customer Name", "Mobile", "Price Range", "Buy Plan"],
    ["demo-003", "Campaign Buyer", "9000000003", "90 lakh", "Next month"],
    ["demo-004", "Campaign Visitor", "9000000004", "1.2 crore", "Within 6 months"],
    ["demo-001", "Sample Buyer", "9000000001", "80 lakh", "Within 3 months"]
  ] }
];
const fixtureResponse = async (input) => {
  if (!input.ranges && !input.requestBody) return { data: { sheets: fixtures
    .filter((item) => item.spreadsheetId === input.spreadsheetId)
    .map((item) => ({ properties: { sheetId: item.tabId, title: item.title } })) } };
  const grid = input.requestBody?.dataFilters?.[0]?.gridRange;
  const fixture = fixtures.find((item) => item.spreadsheetId === input.spreadsheetId
    && (grid ? grid.sheetId === item.tabId : input.ranges?.[0]?.startsWith(`'${item.title}'`)));
  if (!fixture) throw new Error("Demo sheet not found. Use demo-sheet / Demo Leads or demo-campaign / Campaign Leads.");
  const bounded = grid ? grid.endRowIndex === 4 : input.ranges[0].endsWith("!1:4");
  return { data: { properties: { locale: "en_IN" }, sheets: [{
    properties: { sheetId: fixture.tabId, title: fixture.title },
    data: [{ rowData: (bounded ? fixture.rows.slice(0, 4) : fixture.rows)
      .map((row) => ({ values: row.map((formattedValue) => ({ formattedValue })) })) }]
  }] } };
};
google.sheets = () => ({ spreadsheets: {
  get: fixtureResponse,
  getByDataFilter: fixtureResponse
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

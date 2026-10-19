import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { preview } from "vite";

// UI-only fixtures; API persistence and authorization are exercised separately.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const app = await preview({ preview: { host: "127.0.0.1", port: 5182, strictPort: true } });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const source = { spreadsheetId: "qa-sheet", tabId: 12, title: "QA Leads" };
const fields = [
  { key: "meta_lead_id", label: "Lead ID", required: true },
  { key: "meta_created_at", label: "Created Date", required: false },
  { key: "name", label: "Name", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "email", label: "Email", required: false },
  { key: "campaign", label: "Campaign", required: false },
  { key: "looking_for", label: "Budget / Looking For", required: false },
  { key: "buy_plan", label: "Buy Plan", required: false }
];
const budgetHeader = "which_property_price_range_are_you_interested_in_exploring?";
let headers = ["id", "full_name", "phone_number", budgetHeader, "when_you_are_planning_to_buy?", "New budget question"];
const defaults = { meta_lead_id: "id", name: "full_name", phone: "phone_number", looking_for: budgetHeader, buy_plan: "when_you_are_planning_to_buy?" };
let mapping = {}, revision = 0, saves = 0, syncs = 0, previews = 0, failSave = false;
let role = "admin";
const user = () => ({ id: 1, name: "Mapping QA", email: "mapping@example.com", role, active: true });
const response = (draft = mapping) => ({ source, revision, fields, headers, mapping: draft,
  resolved: { ...defaults, ...draft }, samples: [{ meta_lead_id: "l:qa-1", name: "Sample Buyer", phone: "+919000000001", looking_for: "80 lakh", buy_plan: "Within 3 months" }],
  errors: Object.values(draft || {}).filter((h) => h && !headers.includes(h)).map((h) => `Mapped column missing: ${h}`), warnings: [] });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let result = {}, status = 200;
    if (url.pathname === "/api/auth/me") result = { user: user() };
    else if (url.pathname === "/api/users") result = [user()];
    else if (url.pathname === "/api/dashboard") result = { newLeads: 2 };
    else if (url.pathname === "/api/sync/sources") result = { sources: [{ id: "environment", label: "QA Leads", ...source, enabled: true }] };
    else if (url.pathname === "/api/sync") { syncs++; result = { message: "Sync complete. Created 0, updated 0, skipped 2." }; }
    else if (url.pathname === "/api/sync/mapping/preview") { previews++; result = response(req.postDataJSON().mapping); }
    else if (url.pathname === "/api/sync/mapping" && req.method() === "PUT") {
      if (failSave) { status = 409; result = { error: "Column mapping changed. Reload the mapping and try again." }; }
      else { mapping = req.postDataJSON().mapping || {}; revision++; saves++; result = response(); }
    } else if (url.pathname === "/api/sync/mapping") result = response();
    else { status = 404; result = { error: "Unknown fixture route" }; }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) });
  });
  await page.goto("http://127.0.0.1:5182");
  const expand = page.getByRole("button", { name: "Sheet sources & column mapping", exact: true });
  await expand.click();
  const budget = page.getByLabel("Budget / Looking For", { exact: true });
  await budget.waitFor();
  await budget.selectOption({ label: "New budget question" });
  assert.equal(await page.getByRole("button", { name: "Sync Leads", exact: true }).isDisabled(), true);
  await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/sync/mapping/preview"),
    page.getByRole("button", { name: "Preview", exact: true }).click()
  ]);
  await page.getByText("Preview validated.", { exact: true }).waitFor();
  assert.equal(saves, 0);
  assert.equal(syncs, 0);
  await page.getByRole("button", { name: "Save Mapping", exact: true }).click();
  await page.getByText("Mapping saved.", { exact: true }).waitFor();
  await page.reload();
  await expand.click();
  await budget.waitFor();
  assert.equal(await budget.inputValue(), "header:New budget question");
  assert.equal(saves, 1);
  await budget.selectOption({ label: budgetHeader });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  if (!(await budget.isVisible())) await expand.click();
  assert.equal(await budget.inputValue(), "header:New budget question");
  await budget.selectOption({ label: budgetHeader });
  failSave = true;
  await page.getByRole("button", { name: "Save Mapping", exact: true }).click();
  await page.getByText("Column mapping changed. Reload the mapping and try again.", { exact: true }).waitFor();
  assert.equal(await budget.inputValue(), `header:${budgetHeader}`);
  failSave = false;
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  if (!(await budget.isVisible())) await expand.click();
  await page.getByRole("button", { name: "Reset to automatic", exact: true }).click();
  assert.equal(await budget.inputValue(), "auto");
  assert.equal(saves, 1, "reset is a draft until saved");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await budget.inputValue(), "header:New budget question");
  await page.getByRole("button", { name: "Sync Leads", exact: true }).click();
  await page.getByText("Sync complete. Created 0, updated 0, skipped 2.", { exact: true }).waitFor();
  assert.equal(syncs, 1);
  await fs.mkdir("audit/screenshots", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  const screenshotPrefix = process.env.MAPPING_QA_SCREENSHOT_PREFIX || "audit/screenshots/T-011-mapping";
  await page.screenshot({ path: `${screenshotPrefix}-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no mobile horizontal overflow");
  await page.screenshot({ path: `${screenshotPrefix}-mobile.png`, fullPage: true });
  headers = headers.filter((header) => header !== "New budget question");
  await page.reload();
  await expand.click();
  await page.getByText("Mapped column missing: New budget question", { exact: true }).waitFor();
  assert.equal(await budget.inputValue(), "header:New budget question");
  for (const nextRole of ["sales", "manager"]) {
    role = nextRole;
    await page.reload();
    await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
    assert.equal(await expand.count(), 0);
    assert.equal(await page.getByRole("button", { name: "Sync Leads", exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  assert.equal(previews, 1);
  console.log("Sheet mapping UI passed: preview/save isolation, persistence, cancel, conflict recovery, missing headers, admin visibility, desktop/mobile layout.");
} finally {
  await browser.close();
  await new Promise((resolve) => app.httpServer.close(resolve));
}

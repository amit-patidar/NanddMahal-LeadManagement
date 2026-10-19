import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { preview } from "vite";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const app = await preview({ preview: { host: "127.0.0.1", port: 5185, strictPort: true } });
let browser;
const sources = [{ id: "environment", label: "Legacy leads", spreadsheetId: "legacy", tabId: 0, title: "Main leads", enabled: true }];
const mappings = { environment: {} };
const revisions = { environment: 0 };
const user = { id: 1, name: "Sources QA", role: "admin", active: true };
let role = "admin", failAdd = false, syncs = 0;
const errors = [];
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const id = url.searchParams.get("sourceId") || "environment";
    let body = {}, status = 200;
    if (url.pathname === "/api/auth/me") body = { user: { ...user, role } };
    else if (url.pathname === "/api/users") body = [user];
    else if (url.pathname === "/api/dashboard") body = {};
    else if (url.pathname === "/api/sync/sources" && req.method() === "GET") body = { sources };
    else if (url.pathname === "/api/sync/sources") {
      if (failAdd) { status = 400; body = { error: "Cannot read this sheet tab. Check the URL/tab and share the spreadsheet with the configured Google service account." }; }
      else {
        const draft = req.postDataJSON();
        const source = { id: "campaign", label: draft.label, spreadsheetId: "campaign-sheet", tabId: 7, title: "Campaign leads", enabled: true };
        sources.push(source); mappings.campaign = {}; revisions.campaign = 0; body = { source };
      }
    } else if (url.pathname.startsWith("/api/sync/sources/")) {
      const source = sources.find((source) => source.id === url.pathname.split("/").at(-1));
      source.enabled = req.postDataJSON().enabled; body = { source };
    } else if (url.pathname.startsWith("/api/sync/mapping")) {
      const source = sources.find((source) => source.id === id);
      const draft = req.method() === "GET" ? mappings[id] : req.postDataJSON().mapping;
      if (req.method() === "PUT") { mappings[id] = draft; revisions[id]++; }
      body = { source, revision: revisions[id], mapping: draft, headers: ["id", "name", "Budget", "Price range"],
        fields: [{ key: "meta_lead_id", label: "Lead ID", required: true }, { key: "name", label: "Name" }, { key: "looking_for", label: "Budget / Looking For" }],
        resolved: { meta_lead_id: "id", name: "name", looking_for: "Budget", ...draft },
        samples: [{ meta_lead_id: `sample-${id}`, name: id === "environment" ? "Legacy Buyer" : "Campaign Buyer", looking_for: "80 lakh" }], errors: [], warnings: [] };
    } else if (url.pathname === "/api/sync") {
      syncs++;
      body = { message: "Sync complete. Created 1, updated 0, skipped 0, failed rows 0. Failed sources 1 of 2.",
        sources: sources.filter((source) => source.enabled).map((source) => ({ ...source, ok: source.id !== "environment", created: 1, updated: 0, skipped: 0, failed: 0, error: "Check sheet access and column mapping." })),
        errors: ["Legacy leads: Check sheet access and column mapping."] };
    } else { status = 404; body = { error: "Unexpected fixture route" }; }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("http://127.0.0.1:5185");
  const disclosure = page.getByRole("button", { name: "Sheet sources & column mapping", exact: true });
  await disclosure.click();
  await page.getByText("Legacy Buyer", { exact: true }).waitFor();
  const budget = page.getByLabel("Budget / Looking For", { exact: true });
  await budget.selectOption("header:Price range");
  assert.equal(await page.getByRole("button", { name: "Connect sheet", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Map Legacy leads", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Sync Leads", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Save Mapping", exact: true }).click();
  await page.getByText("Mapping saved.", { exact: true }).waitFor();
  await page.getByLabel("Source name", { exact: true }).fill("Campaign leads");
  await page.getByLabel("Google Sheet URL or ID", { exact: true }).fill("https://docs.google.com/spreadsheets/d/campaign-sheet/edit#gid=7");
  await page.getByRole("button", { name: "Connect sheet", exact: true }).click();
  await page.getByText("Campaign Buyer", { exact: true }).waitFor();
  assert.equal(await budget.inputValue(), "auto", "new sources do not inherit other mappings");
  await budget.selectOption("header:Budget");
  assert.equal(await page.getByRole("button", { name: "Map Legacy leads", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByText("Preview validated.", { exact: true }).waitFor();
  assert.equal(syncs, 0, "connect, preview and mapping save never import");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Map Legacy leads", exact: true }).click();
  await page.getByText("Legacy Buyer", { exact: true }).waitFor();
  assert.equal(await budget.inputValue(), "header:Price range");
  await page.reload(); await disclosure.click();
  await page.getByText("Legacy Buyer", { exact: true }).waitFor();
  assert.equal(await budget.inputValue(), "header:Price range", "mapping persists after reload");
  await page.getByRole("button", { name: "Disable Legacy leads", exact: true }).click();
  await page.getByRole("button", { name: "Enable Legacy leads", exact: true }).waitFor();
  await page.getByRole("button", { name: "Enable Legacy leads", exact: true }).click();
  await page.getByRole("button", { name: "Disable Legacy leads", exact: true }).waitFor();
  failAdd = true;
  await page.getByLabel("Source name", { exact: true }).fill("Unavailable source");
  await page.getByLabel("Google Sheet URL or ID", { exact: true }).fill("missing-sheet");
  await page.getByLabel("Tab name", { exact: true }).fill("Missing");
  await page.getByRole("button", { name: "Connect sheet", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Cannot read this sheet tab" }).waitFor();
  assert.equal(await page.getByLabel("Source name", { exact: true }).inputValue(), "Unavailable source");
  await page.getByRole("button", { name: "Sync Leads", exact: true }).click();
  await page.getByLabel("Results by sheet").waitFor();
  assert.match(await page.getByLabel("Results by sheet").innerText(), /Campaign leads: 1 created/);
  assert.match(await page.getByLabel("Results by sheet").innerText(), /Legacy leads: Check sheet access/);
  await page.getByLabel("Source name", { exact: true }).fill("");
  await page.getByLabel("Google Sheet URL or ID", { exact: true }).fill("");
  await page.getByLabel("Tab name", { exact: true }).fill("");
  await page.getByRole("heading", { name: "Dashboard", exact: true }).click();
  await fs.mkdir("audit/screenshots", { recursive: true });
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1100 }], ["mobile", { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${name} has no horizontal page overflow`);
    await page.screenshot({ path: `audit/screenshots/T-013-sheet-sources-${name}.png`, fullPage: true });
  }
  role = "sales";
  await page.reload();
  await page.getByText("Sources QA", { exact: true }).waitFor();
  assert.equal(await disclosure.count(), 0, "sales users cannot see source settings");
  assert.deepEqual(errors, []);
  console.log("PASS desktop/mobile source connection, mapping isolation, preview/save/cancel, reload, dirty guards, enable/disable, failed connection, partial sync results and role visibility");
} finally {
  await browser?.close();
  await app.httpServer.close();
}

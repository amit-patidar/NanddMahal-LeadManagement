import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { preview } from "vite";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const app = await preview({ preview: { host: "127.0.0.1", port: 5184, strictPort: true } });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const user = { id: 1, name: "Filter QA", email: "filter@example.com", role: "admin", active: true };
const leads = [
  { id: "lead-1", name: "Lead One", looking_for: "2 crore", buy_plan: "within_1_month" },
  { id: "lead-2", name: "Lead Two", looking_for: "above_2_crore", buy_plan: "within_2_months" },
  { id: "lead-3", name: "Lead Three", looking_for: "2 crore", buy_plan: "Plot" }
].map((lead) => ({
  ...lead,
  meta_created_at: "2026-09-20T00:00:00.000Z",
  phone: "9000000001",
  status: "Follow Up",
  assigned_to: 1,
  assigned_name: "Filter QA",
  last_comment: "QA"
}));

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let payload;
    if (url.pathname === "/api/auth/me") payload = { user };
    else if (url.pathname === "/api/users") payload = [user];
    else if (url.pathname === "/api/dashboard") payload = {};
    else if (url.pathname === "/api/leads") payload = leads.map((lead) => ({
      ...lead,
      status: url.searchParams.get("list") === "sitevisits" ? "Site Visit" : "Follow Up"
    }));
    else payload = { error: "Unknown fixture route" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });

  await page.goto("http://127.0.0.1:5184");
  await page.getByRole("button", { name: "Follow-ups", exact: true }).click();
  const lookingFor = page.getByLabel("Filter by Looking For", { exact: true });
  const buyPlan = page.getByLabel("Filter by Buy Plan", { exact: true });
  await lookingFor.waitFor();
  await page.getByText("Lead One", { exact: true }).waitFor();
  assert.deepEqual(await lookingFor.locator("option").allTextContents(), ["All", "2 crore", "above_2_crore"]);
  assert.deepEqual(await buyPlan.locator("option").allTextContents(), ["All", "Plot", "within_1_month", "within_2_months"]);

  await lookingFor.selectOption("2 crore");
  assert.deepEqual(await page.locator("tbody .row-link").allTextContents(), ["Lead One", "Lead Three"]);
  await buyPlan.selectOption("Plot");
  assert.deepEqual(await page.locator("tbody .row-link").allTextContents(), ["Lead Three"]);

  await page.getByRole("button", { name: "Tomorrow", exact: true }).click();
  await page.getByText("Lead One", { exact: true }).waitFor();
  assert.equal(await lookingFor.inputValue(), "");
  assert.equal(await buyPlan.inputValue(), "");

  await page.getByRole("button", { name: "Upcoming", exact: true }).click();
  await page.getByText("Lead One", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Filter by Looking For", { exact: true }).count(), 1);

  await page.getByRole("button", { name: "Site Visits", exact: true }).click();
  await page.getByText("Lead One", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Filter by Looking For", { exact: true }).count(), 1);
  assert.equal(await page.getByLabel("Filter by Buy Plan", { exact: true }).count(), 1);

  for (const pageName of ["New Leads", "Super Interested", "Rejected Leads", "All Leads"]) {
    await page.locator("nav").getByRole("button", { name: pageName, exact: true }).click();
    await page.getByText("Lead One", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Filter by Looking For", { exact: true }).count(), 1, `${pageName} has Looking For filter`);
    assert.equal(await page.getByLabel("Filter by Buy Plan", { exact: true }).count(), 1, `${pageName} has Buy Plan filter`);
  }

  await page.locator("nav").getByRole("button", { name: "Missed", exact: true }).click();
  for (const tabName of ["Missed Leads", "Missed Follow-ups", "Missed Site Visits"]) {
    await page.getByRole("button", { name: tabName, exact: true }).click();
    await page.getByText("Lead One", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Filter by Looking For", { exact: true }).count(), 1, `${tabName} has Looking For filter`);
    assert.equal(await page.getByLabel("Filter by Buy Plan", { exact: true }).count(), 1, `${tabName} has Buy Plan filter`);
  }

  await fs.mkdir("audit/screenshots", { recursive: true });
  await page.screenshot({ path: "audit/screenshots/T-012-column-filters-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: "audit/screenshots/T-012-column-filters-mobile.png", fullPage: true });
  assert.deepEqual(pageErrors, []);
  console.log("Lead column filter UI passed: unique options, combined filters, date reset, every lead-list route/tab, and responsive layout.");
} finally {
  await browser.close();
  await new Promise((resolve) => app.httpServer.close(resolve));
}

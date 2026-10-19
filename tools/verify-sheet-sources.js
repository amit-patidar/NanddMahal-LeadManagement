import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { google } from "googleapis";

// Disposable SQLite and mocked Google responses only. Never loads dotenv or calls a live provider.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-sources-qa-"));
Object.assign(process.env, { DATABASE_URL: "", DATABASE_PATH: path.join(directory, "qa.sqlite"), PORT: "0",
  INITIAL_ADMIN_EMAIL: "sources@example.com", INITIAL_ADMIN_PASSWORD: "SourcesQa123!", INITIAL_ADMIN_NAME: "Sources QA",
  COOKIE_SECURE: "false", GOOGLE_SHEET_ID: "first-sheet", GOOGLE_WORKSHEET_NAME: "First",
  GOOGLE_APPLICATION_CREDENTIALS: "", GOOGLE_CLIENT_EMAIL: "", GOOGLE_PRIVATE_KEY: "", GOOGLE_SERVICE_ACCOUNT_JSON: "{}" });
const fixtures = [
  { spreadsheetId: "first-sheet", tabId: 0, title: "First", rows: [["id", "name", "phone"], ["shared", "Original", "9000000001"]] },
  { spreadsheetId: "second-sheet", tabId: 7, title: "Second", rows: [["Custom ID", "Buyer", "Budget"], ["shared", "Changed", "80 lakh"], ["second", "Second Buyer", "1 crore"]] },
  { spreadsheetId: "second-sheet", tabId: 8, title: "Third", rows: [["id", "name"], ["third", "Third Buyer"]] }
];
let unavailable = false;
const originalSheets = google.sheets;
const calls = [];
google.sheets = (options) => {
  assert.deepEqual(options.auth.scopes, ["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  return { spreadsheets: {
  get: async (input) => respond(input, false),
  getByDataFilter: async () => { throw new Error("Request had insufficient authentication scopes."); }
} }; };
function respond(input, numeric) {
  calls.push(input);
  if (unavailable && input.spreadsheetId === "first-sheet") throw new Error("fake secret provider URL");
  if (!input.ranges) return { data: { sheets: fixtures.filter((item) => item.spreadsheetId === input.spreadsheetId)
    .map((item) => ({ properties: { sheetId: item.tabId, title: item.title } })) } };
  const range = input.requestBody?.dataFilters[0]?.gridRange;
  const fixture = fixtures.find((item) => item.spreadsheetId === input.spreadsheetId
    && (numeric ? item.tabId === range.sheetId : input.ranges[0].startsWith(`'${item.title}'`)));
  if (!fixture) throw new Error("Missing fixture");
  const bounded = numeric ? range.endRowIndex === 4 : input.ranges[0].endsWith("!1:4");
  return { data: { properties: { locale: "en_IN" }, sheets: [{ properties: { sheetId: fixture.tabId, title: fixture.title },
    data: [{ rowData: (bounded ? fixture.rows.slice(0, 4) : fixture.rows).map((row) => ({ values: row.map((value) => ({ formattedValue: value })) })) }] }] } };
}
let server, db;
try {
  const database = await import("../server/db.js");
  db = database.db;
  const { sheetSources, parseSheetSource, createSheetSourceService } = await import("../server/sheetSources.js");
  await database.initDb();
  const admin = await database.get("SELECT id FROM users WHERE email = :email", { email: process.env.INITIAL_ADMIN_EMAIL });
  assert.equal((await sheetSources.list()).length, 1);
  await database.initDb();
  assert.equal((await sheetSources.list()).length, 1, "startup adoption is idempotent");
  for (const spreadsheet of ["https://evil.example/spreadsheets/d/test/edit", "../escape", "https://docs.google.com/spreadsheets/d/test/edit#gid=nope"]) {
    assert.throws(() => parseSheetSource({ label: "Bad", spreadsheet }), { status: 400 });
  }
  assert.equal(parseSheetSource({ label: "Zero", spreadsheet: "https://docs.google.com/spreadsheets/d/test/edit#gid=0" }).tabId, 0);
  assert.equal(parseSheetSource({ label: "Title", spreadsheet: "https://docs.google.com/spreadsheets/d/test/edit#gid=7", title: "Override" }).title, "Override");
  await assert.rejects(sheetSources.add({ label: "Duplicate", spreadsheet: "first-sheet", title: "First" }, admin.id), { status: 409 });
  const second = await sheetSources.add({ label: "Second source", spreadsheet: "https://docs.google.com/spreadsheets/d/second-sheet/edit#gid=7" }, admin.id);
  const third = await sheetSources.add({ label: "Third source", spreadsheet: "second-sheet", title: "Third" }, admin.id);
  assert.equal((await sheetSources.list()).length, 3);
  await assert.rejects(sheetSources.add({ label: "Duplicate", spreadsheet: "second-sheet", title: "Second" }, admin.id), { status: 409 });
  const mapping = await sheetSources.mapping(second.id);
  const loaded = await mapping.get();
  assert.ok(loaded.errors.length, "custom headers require explicit mapping");
  await mapping.save({ source: loaded.source, revision: loaded.revision,
    mapping: { meta_lead_id: "Custom ID", name: "Buyer", looking_for: "Budget" } }, admin.id);
  assert.equal(await database.getSheetMapping("first-sheet", 0), null);
  assert.equal(await database.getSheetMapping("second-sheet", 8), null);
  const firstSync = await sheetSources.sync(admin.id);
  assert.equal(firstSync.created, 3, "same global ID is not duplicated across sheets");
  assert.equal(firstSync.updated, 1, "blank source fields may be filled from another source");
  assert.equal(firstSync.failedSources, 0);
  const lead = await database.get("SELECT * FROM leads WHERE meta_lead_id = 'shared'");
  assert.equal(lead.name, "Original");
  assert.equal(lead.looking_for, "80 lakh");
  await database.run("UPDATE leads SET status = 'Follow Up', followup_date = '2026-11-01', last_comment = 'Keep me' WHERE id = :id", { id: lead.id });
  const repeated = await sheetSources.sync(admin.id);
  assert.equal(repeated.created, 0);
  assert.equal(repeated.updated, 0);
  const protectedLead = await database.get("SELECT * FROM leads WHERE id = :id", { id: lead.id });
  assert.equal(protectedLead.status, "Follow Up");
  assert.equal(protectedLead.followup_date, "2026-11-01");
  assert.equal(protectedLead.last_comment, "Keep me");
  fixtures[1].title = "Renamed tab";
  assert.equal((await (await sheetSources.mapping(second.id)).get()).source.title, "Renamed tab");
  const { readGoogleSheet } = await import("../server/sheetsSync.js");
  const requests = [];
  const readOnlySheets = { spreadsheets: { get: async (input) => {
    requests.push(input);
    if (!input.ranges) return { data: { sheets: [{ properties: { sheetId: 7, title: "Renamed ' Leads" } }] } };
    return { data: { sheets: [{ properties: { sheetId: 7, title: "Renamed ' Leads" }, data: [] }] } };
  } } };
  await readGoogleSheet({ source: second, sheets: readOnlySheets });
  assert.deepEqual(requests[1].ranges, ["'Renamed '' Leads'!1:4"]);
  requests.length = 0;
  await readGoogleSheet({ source: second, full: true, sheets: readOnlySheets });
  assert.deepEqual(requests[1].ranges, ["'Renamed '' Leads'"]);
  await assert.rejects(readGoogleSheet({ source: second, sheets: { spreadsheets: { get: async (input) => ({ data: {
    sheets: [{ properties: { sheetId: input.ranges ? 99 : 7, title: "Reused title" } }]
  } }) } } }), { status: 409 }, "tab replacement between metadata and data must never import another tab");
  console.log("PASS read-only OAuth scope, GET-only pinned tab reads, escaped preview/full ranges and tab identity race rejection");
  unavailable = true;
  const partial = await sheetSources.sync(admin.id);
  assert.equal(partial.failedSources, 1);
  assert.equal(partial.sources.filter((source) => source.ok).length, 2);
  assert.ok(!JSON.stringify(partial).includes("fake secret"));
  await sheetSources.update("environment", { enabled: false });
  assert.equal((await sheetSources.sync(admin.id)).failedSources, 0);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM leads")).count, 3);
  await assert.rejects(sheetSources.update(third.id, { enabled: "false" }), { status: 400 });
  await assert.rejects(sheetSources.mapping("unknown"), { status: 404 });
  const restart = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { sheetSources } = await import(${JSON.stringify(new URL("../server/sheetSources.js", import.meta.url).href)});
    const sources = await sheetSources.list();
    if (sources.length !== 3 || sources.find(s => s.id === 'environment').enabled) process.exitCode = 1;
    const { db } = await import(${JSON.stringify(new URL("../server/db.js", import.meta.url).href)}); db.close();
  `], { env: { ...process.env, NODE_OPTIONS: "" }, encoding: "utf8" });
  assert.equal(restart.status, 0, restart.stderr);
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const concurrent = createSheetSourceService({ mappingFor: () => ({ sync: async () => { await blocked; return { configured: true }; } }) });
  const ongoing = concurrent.sync(admin.id);
  await assert.rejects(concurrent.sync(admin.id), { status: 409 });
  release(); await ongoing;
  console.log("PASS source validation, adoption, persistence, per-tab mapping, renamed tabs, duplicate protection, protected CRM fields, partial sync, disable and concurrency");

  server = (await import("../server/server.js")).server;
  if (!server.listening) await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, method = "GET", body, cookie) {
    const response = await fetch(base + route, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      ...(body === undefined || method === "GET" ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const login = await request("/api/auth/login", "POST", { identifier: process.env.INITIAL_ADMIN_EMAIL, password: process.env.INITIAL_ADMIN_PASSWORD });
  process.env.RENDER_GIT_COMMIT = "qa-commit";
  assert.deepEqual((await request("/api/health")).body, { ok: true, commit: "qa-commit" });
  assert.equal(login.status, 200);
  const routes = [["/api/sync/sources", "GET"], ["/api/sync/sources", "POST"], [`/api/sync/sources/${second.id}`, "PATCH"],
    [`/api/sync/mapping?sourceId=${second.id}`, "GET"], [`/api/sync/mapping?sourceId=${second.id}`, "PUT"],
    [`/api/sync/mapping/preview?sourceId=${second.id}`, "POST"], ["/api/sync", "POST"]];
  for (const [route, method] of routes) assert.equal((await request(route, method)).status, 401);
  for (const role of ["sales", "manager"]) {
    await request("/api/users", "POST", { name: role, email: `${role}@example.com`, password: "SourcesQa123!", role }, login.cookie);
    const other = await request("/api/auth/login", "POST", { identifier: `${role}@example.com`, password: "SourcesQa123!" });
    const before = calls.length;
    for (const [route, method] of routes) assert.equal((await request(route, method, {}, other.cookie)).status, 403);
    assert.equal(calls.length, before, "denied requests never contact Google");
  }
  assert.equal((await request("/api/sync/sources", "GET", undefined, login.cookie)).body.sources.length, 3);
  assert.equal((await request(`/api/sync/mapping?sourceId=${second.id}`, "GET", undefined, login.cookie)).body.source.title, "Renamed tab");
  assert.equal((await request("/api/sync", "POST", {}, login.cookie)).body.sources.length, 2);
  assert.equal((await request(`/api/sync/sources/${third.id}`, "PATCH", { enabled: false }, login.cookie)).status, 200);
  assert.equal((await request("/api/sync/mapping?sourceId=unknown", "GET", undefined, login.cookie)).status, 404);
  await sheetSources.update(second.id, { enabled: false });
  const emptySync = await sheetSources.sync(admin.id);
  assert.equal(emptySync.sources.length, 0);
  assert.equal(emptySync.created, 0);
  assert.match(emptySync.message, /No enabled sheet sources/);
  console.log("PASS authenticated source APIs, selected-source mapping, aggregate sync, unknown source and role isolation");
} finally {
  google.sheets = originalSheets;
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (db) db.close();
  // The exact temporary directory created by this verifier is the only cleanup target.
  await fs.rm(directory, { recursive: true, force: true });
}

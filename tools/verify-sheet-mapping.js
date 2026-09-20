import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { google } from "googleapis";
import { createSheetMappingService, mapSheetRow, readGoogleSheet } from "../server/sheetsSync.js";

// No dotenv, real database, credentials, or external API is used by this verifier.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-mapping-qa-"));
Object.assign(process.env, {
  DATABASE_URL: "", DATABASE_PATH: path.join(directory, "qa.sqlite"), PORT: "0",
  INITIAL_ADMIN_EMAIL: "mapping-qa@example.com", INITIAL_ADMIN_PASSWORD: "MappingQa123!",
  INITIAL_ADMIN_NAME: "Mapping QA", COOKIE_SECURE: "false",
  GOOGLE_SHEET_ID: "qa-sheet", GOOGLE_WORKSHEET_NAME: "QA's Leads",
  GOOGLE_APPLICATION_CREDENTIALS: "", GOOGLE_CLIENT_EMAIL: "", GOOGLE_PRIVATE_KEY: "",
  GOOGLE_SERVICE_ACCOUNT_JSON: "{}"
});
let server;
let database;
const originalSheets = google.sheets;
const calls = [];
let sheetRows = [["id", "name", "phone"], ["00123", "QA", "001234567890"]];
const gridData = (rows) => [{ rowData: rows.map((row) => ({ values: row.map((value) => ({ formattedValue: String(value) })) })) }];
const mockSheets = { spreadsheets: {
  async get(input) {
    calls.push(input);
    return { data: { properties: { locale: "en_IN" }, sheets: [{
      properties: { sheetId: 7, title: "QA's Leads" },
      data: gridData(input.ranges[0].endsWith("!1:4") ? sheetRows.slice(0, 4) : sheetRows)
    }] } };
  }
} };
google.sheets = () => mockSheets;
let groups = 0;
function pass(label) { groups += 1; console.log(`PASS ${label}`); }

try {
  const db = await import("../server/db.js");
  database = db.db;
  await db.initDb();
  const admin = await db.get("SELECT id FROM users WHERE email = :email", { email: process.env.INITIAL_ADMIN_EMAIL });
  const userId = admin.id;
  const service = createSheetMappingService();
  const initial = await service.get();
  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.mapping, {});
  assert.equal(initial.fields.length, 8);
  assert.equal(initial.samples[0].meta_lead_id, "00123");
  assert.equal(initial.samples[0].phone, "001234567890");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fields, "properties(locale),sheets(properties(sheetId,title),data(rowData(values(formattedValue))))");
  assert.deepEqual(calls[0].ranges, ["'QA''s Leads'!1:4"]);
  assert.equal(mapSheetRow(["ID", "full_name", "budget", "buy_plan"], [0, "Ada", "80 lakh", "Soon"]).meta_lead_id, "0");
  assert.equal(mapSheetRow(["which_property_price_range_are_you_interested_in_exploring?"], ["80 lakh"]).looking_for, "80 lakh");
  pass("automatic aliases, string values, metadata lookup and escaped bounded range");

  const body = { source: initial.source, revision: 0, mapping: { meta_lead_id: "id", phone: null } };
  assert.equal((await service.preview(body)).resolved.phone, null);
  assert.equal(await db.getSheetMapping("qa-sheet", 7), null);
  const competing = await Promise.allSettled([service.save(body, userId), service.save(body, userId)]);
  assert.equal(competing.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(competing.find((entry) => entry.status === "rejected").reason.status, 409);
  assert.equal((await service.get()).revision, 1);
  const reset = await service.save({ ...body, revision: 1, mapping: null }, userId);
  assert.equal(reset.revision, 2);
  assert.deepEqual(reset.mapping, {});
  assert.equal((await db.getSheetMapping("qa-sheet", 7)).mapping, null);
  await assert.rejects(service.save({ ...body, revision: 1 }, userId), { status: 409 });
  await db.saveSheetMapping({ spreadsheetId: "qa-sheet", tabId: 8, mapping: { phone: null }, revision: 0, userId });
  await db.saveSheetMapping({ spreadsheetId: "other-sheet", tabId: 7, mapping: {}, revision: 0, userId });
  assert.equal((await db.getSheetMapping("qa-sheet", 7)).revision, 2);
  assert.equal((await db.getSheetMapping("qa-sheet", 8)).revision, 1);
  assert.equal(await db.getSheetMapping("other-sheet", 8), null);
  const restart = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { getSheetMapping, db } = await import(${JSON.stringify(new URL("../server/db.js", import.meta.url).href)});
    const row = await getSheetMapping("qa-sheet", 7);
    if (row.revision !== 2 || row.mapping !== null) process.exitCode = 1;
    db.close();
  `], { env: { ...process.env, NODE_OPTIONS: "" }, encoding: "utf8" });
  assert.equal(restart.status, 0, restart.stderr);
  pass("read-only preview, concurrent compare-and-swap, reset revision, restart persistence and source isolation");

  const currentBody = { ...body, revision: 2 };
  for (const mapping of [{ unexpected: "id" }, { meta_lead_id: null }, { meta_lead_id: "renamed" }, { phone: "id" }, [], { phone: 123 }, undefined]) {
    const preview = await service.preview({ ...currentBody, mapping });
    assert.ok(preview.errors.length);
    await assert.rejects(service.save({ ...currentBody, mapping }, userId), { status: 400 });
  }
  assert.ok((await service.preview({ ...currentBody, source: { ...body.source, tabId: 99 } })).errors.some((error) => error.includes("source changed")));
  await assert.rejects(service.save({ ...currentBody, source: { ...body.source, title: "Old title" } }, userId), { status: 409 });
  assert.ok((await service.preview(body)).errors.some((error) => error.includes("revision")));
  sheetRows = [["id", "ID", ""], ["a", "b", "c"]];
  assert.ok((await service.get()).errors.some((error) => error.includes("ambiguous")));
  await assert.rejects(service.sync(userId), { status: 400 });
  sheetRows = [];
  assert.ok((await service.get()).errors.some((error) => error.includes("required")));
  pass("invalid mappings, stale sources/revisions, duplicate and empty headers fail before import");

  let preflightImports = 0;
  const missingHeader = createSheetMappingService({
    readSheet: async () => ({ source: initial.source, rows: [["id", "renamed_phone"], ["preflight", "001"]] }),
    getSheetMapping: async () => ({ mapping: { phone: "phone" }, revision: 1 }),
    createLeadFromSource: async () => { preflightImports += 1; return { created: true }; }
  });
  await assert.rejects(missingHeader.sync(), { status: 400 });
  assert.equal(preflightImports, 0);
  pass("missing explicit header preflight performs zero lead imports");

  sheetRows = [["id", "name", "phone", "created_time", "external"], ["00123", "QA", "001234567890", "2026-09-20", "alternate"]];
  assert.ok((await service.preview({ ...currentBody, mapping: { meta_lead_id: "external" } })).warnings.some((warning) => warning.includes("Lead ID mapping changed")));
  await service.save({ ...currentBody, mapping: { meta_lead_id: "id", phone: "phone" } }, userId);
  const beforeSync = calls.length;
  assert.equal((await service.sync(userId)).created, 1);
  assert.equal(calls.length - beforeSync, 1);
  assert.deepEqual(calls.at(-1).ranges, ["'QA''s Leads'"]);
  sheetRows = [["phone", "name", "id", "created_time"], ["001234567890", "QA", "00123", "2026-09-20"]];
  assert.equal((await service.sync(userId)).skipped, 1);
  const imported = await db.get("SELECT * FROM leads WHERE meta_lead_id = '00123'");
  assert.equal(imported.phone, "001234567890");
  await db.run("UPDATE leads SET status = 'Follow Up', last_comment = 'Customer comment', followup_date = '2026-10-01', rejection_reason = 'Other' WHERE id = :id", { id: imported.id });
  sheetRows = [["id", "name", "phone", "email"], ["00123", "Replacement", "999999999999", "qa@example.com"]];
  assert.equal((await service.sync(userId)).updated, 1);
  const enriched = await db.get("SELECT * FROM leads WHERE id = :id", { id: imported.id });
  for (const [key, value] of Object.entries({ status: "Follow Up", last_comment: "Customer comment", followup_date: "2026-10-01", rejection_reason: "Other", name: "QA", phone: "001234567890", email: "qa@example.com" })) assert.equal(enriched[key], value);
  assert.ok((await db.all("SELECT * FROM lead_activities WHERE lead_id = :id", { id: imported.id })).some((entry) => entry.activity_type === "Sync Updated"));

  await db.run(`INSERT INTO leads
    (meta_lead_id, created_at, meta_created_at, name, phone, campaign, status, last_activity_at, last_comment)
    VALUES ('ignore-existing', '2026-09-01', '', 'Unknown Lead', '', 'Meta Campaign', 'New', '2026-09-01', 'Keep this comment')`);
  const ignoredExisting = createSheetMappingService({
    readSheet: async () => ({
      source: initial.source, locale: "en_IN",
      rows: [["id", "name", "campaign", "created_time"], ["ignore-existing", "Invented Name", "Invented Campaign", "20/09/2026"]]
    }),
    getSheetMapping: async () => ({
      mapping: { meta_lead_id: "id", name: null, campaign: null, meta_created_at: null }, revision: 1
    }),
    createLeadFromSource: db.createLeadFromSource
  });
  assert.equal((await ignoredExisting.sync(userId)).skipped, 1);
  const ignoredLead = await db.get("SELECT * FROM leads WHERE meta_lead_id = 'ignore-existing'");
  assert.deepEqual(
    [ignoredLead.name, ignoredLead.campaign, ignoredLead.meta_created_at, ignoredLead.last_comment],
    ["Unknown Lead", "Meta Campaign", "", "Keep this comment"]
  );
  pass("name-based reorder, one Google read per sync, idempotence, enrichment and protected CRM/comment retention");

  const rows = [["id", "name", "phone", "created_time"], ["duplicate"], ["duplicate"], ["manual:reserved"], [""], ["bad-date", "", "", "2026-02-30"], ["ok", "A", "001"], ["fail", "B", "002"], ["updated", "C", "003"]];
  let saved = { mapping: null, revision: 4 };
  let mappingReads = 0;
  const seen = [];
  const isolated = createSheetMappingService({
    readSheet: async () => ({ source: initial.source, rows }),
    getSheetMapping: async () => { mappingReads += 1; return saved; },
    createLeadFromSource: async (source) => {
      seen.push(source.meta_lead_id);
      saved.mapping = { meta_lead_id: "phone" };
      saved.revision = 5;
      if (source.meta_lead_id === "fail") throw new Error("simulated failure");
      return { created: source.meta_lead_id === "ok", updated: source.meta_lead_id === "updated" };
    }
  });
  const partial = await isolated.sync();
  assert.deepEqual([partial.created, partial.updated, partial.skipped, partial.failed], [1, 1, 5, 1]);
  assert.deepEqual(seen, ["ok", "fail", "updated"]);
  assert.equal(mappingReads, 1);
  assert.equal(partial.revision, 4);
  assert.ok(partial.warnings.some((warning) => warning.includes("missing phone")));

  const parsedDates = [];
  const dateService = (locale, dateRows) => createSheetMappingService({
    readSheet: async () => ({ source: initial.source, locale, rows: [["id", "created_time"], ...dateRows] }),
    getSheetMapping: async () => null,
    createLeadFromSource: async (source) => { parsedDates.push(source.meta_created_at); return { created: true }; }
  });
  const indiaDates = await dateService("en_IN", [["india-valid", "20/09/2026"], ["india-invalid", "30/02/2026"]]).sync();
  assert.deepEqual([indiaDates.created, indiaDates.skipped], [1, 1]);
  assert.equal(parsedDates[0], "2026-09-20T00:00:00.000Z");
  const usDates = await dateService("en_US", [
    ["us-valid", "09/20/2026"],
    ["iso-precision", "2026-09-20T10:15:30.123456Z"],
    ["us-invalid", "02/30/2026"]
  ]).sync();
  assert.deepEqual([usDates.created, usDates.skipped], [2, 1]);
  assert.equal(parsedDates[1], "2026-09-20T00:00:00.000Z");
  assert.equal(parsedDates[2], "2026-09-20T10:15:30.123Z");
  const failingReader = createSheetMappingService({ readSheet: async () => { throw new Error("mock Google unavailable"); } });
  await assert.rejects(failingReader.get(), /mock Google unavailable/);
  await assert.rejects(failingReader.sync(), /mock Google unavailable/);
  await assert.rejects(readGoogleSheet({ sheets: { spreadsheets: { get: async () => ({ data: { sheets: [] } }) } } }), /tab was not found/);
  pass("duplicate/reserved/missing IDs, invalid dates, useful partial counts, frozen sync revision and API failure");

  sheetRows = [["id", "name", "phone"], ["http-qa", "HTTP QA", "001"], ["http-2"], ["http-3"], ["http-4"]];
  server = (await import("../server/server.js")).server;
  if (!server.listening) await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, method = "GET", body, cookie) {
    const response = await fetch(base + route, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const login = await request("/api/auth/login", "POST", { identifier: process.env.INITIAL_ADMIN_EMAIL, password: process.env.INITIAL_ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  const routes = [["/api/sync/mapping", "GET"], ["/api/sync/mapping", "PUT"], ["/api/sync/mapping/preview", "POST"]];
  for (const [route, method] of routes) assert.equal((await request(route, method)).status, 401);
  for (const role of ["manager", "sales"]) {
    assert.equal((await request("/api/users", "POST", { name: role, email: `${role}@example.com`, password: "MappingQa123!", role }, login.cookie)).status, 201);
    const other = await request("/api/auth/login", "POST", { identifier: `${role}@example.com`, password: "MappingQa123!" });
    const before = calls.length;
    for (const [route, method] of routes) assert.equal((await request(route, method, undefined, other.cookie)).status, 403);
    assert.equal(calls.length, before);
  }
  const loaded = await request("/api/sync/mapping", "GET", undefined, login.cookie);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.samples.length, 3);
  assert.deepEqual(Object.keys(loaded.body).sort(), ["source", "revision", "fields", "headers", "mapping", "resolved", "samples", "errors", "warnings"].sort());
  const httpBody = { source: loaded.body.source, revision: loaded.body.revision, mapping: null };
  const countBefore = await db.get("SELECT COUNT(*) AS count FROM leads");
  assert.equal((await request("/api/sync/mapping/preview", "POST", { ...httpBody, mapping: { phone: "missing" } }, login.cookie)).body.errors.length, 1);
  assert.equal((await request("/api/sync/mapping", "PUT", { ...httpBody, mapping: { phone: "missing" } }, login.cookie)).status, 400);
  assert.equal((await request("/api/sync/mapping", "PUT", httpBody, login.cookie)).status, 200);
  assert.equal((await request("/api/sync/mapping", "PUT", httpBody, login.cookie)).status, 409);
  assert.deepEqual(await db.get("SELECT COUNT(*) AS count FROM leads"), countBefore);
  pass("HTTP authorization for every mapping route, bounded contract, read-only preview/save and stale-save status");
  console.log(`Sheet mapping verification passed: ${groups} groups. Mock Google and temporary SQLite only.`);
} finally {
  google.sheets = originalSheets;
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (database) database.close();
  // Only the directory created above is removed; no repository data is touched.
  await fs.rm(directory, { recursive: true, force: true });
}

import { randomUUID } from "node:crypto";
import { all, get, run } from "./db.js";
import { createSheetMappingService, readGoogleSheet } from "./sheetsSync.js";

function fail(status, message) { return Object.assign(new Error(message), { status }); }

export function parseSheetSource(body) {
  const input = String(body?.spreadsheet || "").trim();
  const label = String(body?.label || "").trim();
  const title = String(body?.title || "").trim();
  if (!label || label.length > 100) throw fail(400, "Enter a source name up to 100 characters.");
  let spreadsheetId = input;
  let tabId;
  if (input.startsWith("https://")) {
    let url;
    try { url = new URL(input); } catch { throw fail(400, "Enter a Google Sheets URL or spreadsheet ID."); }
    const match = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/);
    if (url.hostname !== "docs.google.com" || url.username || url.password || !match) {
      throw fail(400, "Enter a docs.google.com spreadsheet URL.");
    }
    spreadsheetId = match[1];
    const gid = new URLSearchParams(url.hash.slice(1)).get("gid") ?? url.searchParams.get("gid");
    if (gid !== null) {
      if (!/^\d+$/.test(gid) || !Number.isSafeInteger(Number(gid)) || Number(gid) > 2147483647) throw fail(400, "Invalid sheet tab ID in the URL.");
      tabId = Number(gid);
    }
  }
  if (!/^[\w-]{1,200}$/.test(spreadsheetId)) throw fail(400, "Enter a valid spreadsheet ID or Google Sheets URL.");
  if (title.length > 100 || (tabId === undefined && !title)) throw fail(400, "Enter the tab name or paste a sheet URL containing gid.");
  // An explicit tab name takes precedence over the currently selected tab in a pasted URL.
  return { label, spreadsheetId, ...(title ? { title } : { tabId }) };
}

function publicSource(row) {
  return { id: row.id, label: row.label, spreadsheetId: row.spreadsheet_id,
    tabId: row.tab_id == null ? null : Number(row.tab_id), title: row.title, enabled: Boolean(row.enabled) };
}

export function createSheetSourceService(dependencies = {}) {
  const read = dependencies.readSheet || readGoogleSheet;
  const mappingFor = dependencies.mappingFor || ((source) => createSheetMappingService({ source, readSheet: async (options) => {
    const sheet = await read(options);
    // Carry the legacy source forward using its stable numeric tab ID after the first successful read.
    if (source.tabId === null) {
      await run("UPDATE sheet_sync_sources SET tab_id = :tabId, title = :title WHERE id = :id AND tab_id IS NULL",
        { id: source.id, tabId: sheet.source.tabId, title: sheet.source.title });
    }
    return sheet;
  } }));
  let syncing = false;

  async function list() {
    return (await all("SELECT * FROM sheet_sync_sources ORDER BY created_at, id")).map(publicSource);
  }
  async function find(id) {
    const row = await get("SELECT * FROM sheet_sync_sources WHERE id = :id", { id });
    if (!row) throw fail(404, "Sheet source not found. Reload the sources list.");
    return publicSource(row);
  }
  async function mapping(id) {
    if (!id) return createSheetMappingService({ readSheet: read }); // Existing single-source API compatibility.
    const source = await find(id);
    return mappingFor(source);
  }
  return {
    list, mapping,
    async add(body, userId) {
      const input = parseSheetSource(body);
      let sheet;
      try { sheet = await read({ source: input }); } catch {
        throw fail(400, "Cannot read this sheet tab. Check the URL/tab and share the spreadsheet with the configured Google service account.");
      }
      const sources = await list();
      if (sources.some((source) => source.spreadsheetId === sheet.source.spreadsheetId
        && (source.tabId === sheet.source.tabId || (source.tabId === null && source.title === sheet.source.title)))) {
        throw fail(409, "This spreadsheet tab is already connected. Enable its existing source instead.");
      }
      const id = randomUUID();
      try {
        await run(`INSERT INTO sheet_sync_sources
          (id, label, spreadsheet_id, tab_id, title, enabled, created_by, created_at)
          VALUES (:id, :label, :spreadsheetId, :tabId, :title, 1, :userId, :createdAt)`,
        { id, label: input.label, ...sheet.source, userId, createdAt: new Date().toISOString() });
      } catch (error) {
        if (error.code === "23505" || String(error.code).startsWith("ERR_SQLITE") && /UNIQUE/.test(error.message)) {
          throw fail(409, "This spreadsheet tab is already connected.");
        }
        throw error;
      }
      return find(id);
    },
    async update(id, body) {
      await find(id);
      if (typeof body?.enabled !== "boolean") throw fail(400, "Enabled must be true or false.");
      await run("UPDATE sheet_sync_sources SET enabled = :enabled WHERE id = :id", { id, enabled: body.enabled ? 1 : 0 });
      return find(id);
    },
    async sync(userId) {
      if (syncing) throw fail(409, "A sheet sync is already running. Wait for it to finish.");
      syncing = true;
      try {
        const sources = (await list()).filter((source) => source.enabled);
        const result = { configured: sources.length > 0, created: 0, updated: 0, skipped: 0, failed: 0,
          failedSources: 0, sources: [], errors: [], warnings: [] };
        for (const source of sources) {
          try {
            const summary = await mappingFor(source).sync(userId);
            if (summary.configured === false) throw fail(503, "Google Sheets credentials are not configured.");
            result.sources.push({ id: source.id, label: source.label, ...summary, ok: true });
            for (const key of ["created", "updated", "skipped", "failed"]) result[key] += summary[key] || 0;
            for (const key of ["errors", "warnings"]) result[key].push(...(summary[key] || []).map((issue) => `${source.label}: ${issue}`));
          } catch {
            // Provider errors can contain sensitive request/configuration details; keep them out of responses.
            const error = "Sync could not complete. Check sheet access and column mapping, then retry.";
            result.failedSources += 1;
            result.sources.push({ id: source.id, label: source.label, ok: false, error });
            result.errors.push(`${source.label}: ${error}`);
          }
        }
        result.message = sources.length
          ? `Sync complete. Created ${result.created}, updated ${result.updated}, skipped ${result.skipped}, failed rows ${result.failed}. Failed sources ${result.failedSources} of ${sources.length}.`
          : "No enabled sheet sources. Connect or enable a source below.";
        return result;
      } finally { syncing = false; }
    }
  };
}

export const sheetSources = createSheetSourceService();

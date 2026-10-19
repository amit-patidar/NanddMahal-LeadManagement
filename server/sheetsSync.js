import { google } from "googleapis";

const headerAliases = {
  meta_lead_id: ["meta lead id", "lead id", "id", "meta_lead_id"],
  meta_created_at: ["created time", "created_time", "created_at", "meta creation date", "meta_created_at", "created date"],
  name: ["name", "full name", "full_name", "customer name"],
  phone: ["phone", "phone number", "phone_number", "mobile", "mobile number", "mobile_number"],
  email: ["email", "email address"],
  campaign: ["campaign", "project", "campaign name", "campaign_name", "ad name", "ad_name"],
  looking_for: [
    "which_property_price_range_are_you_interested_in_exploring?",
    "which_property_price_range_are_you_interested_in_exploring",
    "which property price range are you interested in exploring?",
    "property price range",
    "price range",
    "budget",
    "what_are_you_looking_for?",
    "what are you looking for?",
    "looking for",
    "requirement",
    "property requirement",
    "looking_for"
  ],
  buy_plan: [
    "when_you_are_planning_to_buy?",
    "when_you_are_planning_to_buy",
    "when you are planning to buy?",
    "when_are_you_planning_to_buy?",
    "when are you planning to buy?",
    "planning to buy",
    "buy plan",
    "buy timeline",
    "buy_plan"
  ]
};

const labels = ["Lead ID", "Source creation date", "Name", "Phone", "Email", "Campaign", "Budget / Looking For", "Buy Plan"];
const fields = Object.keys(headerAliases).map((key, index) => ({ key, label: labels[index], required: key === "meta_lead_id" }));
const normalizeHeader = (value) => String(value ?? "").trim().toLowerCase();

function mappingError(status, message, response) {
  return Object.assign(new Error(message), { status, mappingResponse: response });
}

export async function readGoogleSheet({ full = false, sheets: injectedSheets, source } = {}) {
  const spreadsheetId = source?.spreadsheetId || process.env.GOOGLE_SHEET_ID;
  let title = source?.title || process.env.GOOGLE_WORKSHEET_NAME || "Nandd Mahal Leads";
  const authConfig = injectedSheets ? null : googleAuthConfig();
  if (!spreadsheetId || (!injectedSheets && !authConfig)) {
    throw Object.assign(mappingError(503, "Google Sheets sync is not configured."), { configured: false });
  }
  const sheets = injectedSheets || google.sheets({ version: "v4", auth: new google.auth.GoogleAuth(authConfig) });
  // getByDataFilter does not accept spreadsheets.readonly. Resolve the stable tab ID
  // using read-only metadata, then validate identity again with the returned cells.
  if (Number.isSafeInteger(source?.tabId)) {
    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
    const tab = metadata.data.sheets?.find((entry) => entry.properties.sheetId === source.tabId);
    if (!tab) throw mappingError(400, "Configured Google Sheet tab was not found.");
    title = tab.properties.title;
  }
  const responseFields = "properties(locale),sheets(properties(sheetId,title),data(rowData(values(formattedValue))))";
  const result = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`'${title.replace(/'/g, "''")}'${full ? "" : "!1:4"}`],
    fields: responseFields
  });
  const sheet = result.data.sheets?.find((entry) => Number.isSafeInteger(source?.tabId)
    ? entry.properties.sheetId === source.tabId : entry.properties.title === title);
  if (!sheet) {
    if (Number.isSafeInteger(source?.tabId)) throw mappingError(409, "Google Sheet tab changed while reading. Refresh headers and retry.");
    throw mappingError(400, "Configured Google Sheet tab was not found.");
  }
  const tab = sheet.properties;
  return {
    source: { spreadsheetId, tabId: tab.sheetId, title: tab.title },
    locale: result.data.properties?.locale || "en_IN",
    rows: (sheet.data?.[0]?.rowData || []).map((row) => (row.values || []).map((cell) => cell.formattedValue ?? ""))
  };
}

function resolveMapping(headers, mapping) {
  const errors = [];
  const resolved = {};
  const indices = {};
  if (mapping !== null && (typeof mapping !== "object" || Array.isArray(mapping))) {
    errors.push("Mapping must be an object or null for automatic.");
    mapping = null;
  }
  for (const key of Object.keys(mapping || {})) {
    if (!Object.hasOwn(headerAliases, key)) errors.push(`Unknown mapping field: ${key}.`);
  }
  const used = new Set();
  for (const { key, label, required } of fields) {
    const explicit = mapping !== null && Object.hasOwn(mapping, key);
    const selected = explicit ? mapping[key] : headers.find((header) => headerAliases[key].includes(normalizeHeader(header)));
    let index = -1;
    if (selected != null) {
      if (typeof selected !== "string" || !selected.trim()) {
        errors.push(`${label}: select a nonblank header or null.`);
      } else {
        index = headers.indexOf(selected);
        if (index < 0) errors.push(`${label}: mapped header "${selected}" is missing.`);
        else if (headers.filter((header) => normalizeHeader(header) === normalizeHeader(selected)).length > 1) {
          errors.push(`${label}: header "${selected}" is ambiguous.`);
        }
        if (used.has(selected)) errors.push(`${label}: header "${selected}" is already mapped to another field.`);
        used.add(selected);
      }
    }
    if (required && index < 0) errors.push("A stable Lead ID header is required.");
    indices[key] = index;
    resolved[key] = index < 0 ? null : headers[index];
  }
  return { errors, resolved, indices };
}

function mappedRow(indices, row) {
  return Object.fromEntries(fields.map(({ key }) => [key, indices[key] < 0 ? "" : String(row[indices[key]] ?? "").trim()]));
}

function sourceDateParser(locale = "en_IN") {
  let order;
  try {
    order = new Intl.DateTimeFormat(locale.replace(/_/g, "-"), {
      year: "numeric", month: "numeric", day: "numeric", calendar: "gregory", timeZone: "UTC"
    }).formatToParts(new Date("2006-11-22T00:00:00Z"))
      .filter((part) => ["year", "month", "day"].includes(part.type)).map((part) => part.type);
  } catch { order = []; }
  return (value) => {
    if (!value) return { value: "" };
    const invalid = { error: `invalid source creation date for ${locale}; use ISO or locale-ordered numeric dates with a four-digit year and optional time; skipped.` };
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
    const local = iso ? null : value.match(/^(\d{1,4})([/.\-])(\d{1,2})\2(\d{1,4})(.*)$/);
    let year, month, day, tail;
    if (iso) {
      [, year, month, day, tail] = iso;
    } else if (local && order.length === 3) {
      const parts = Object.fromEntries(order.map((key, index) => [key, [local[1], local[3], local[4]][index]]));
      ({ year, month, day } = parts);
      if (year.length !== 4 || month.length > 2 || day.length > 2) return invalid;
      tail = local[5];
    } else return invalid;
    [year, month, day] = [year, month, day].map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    // Validate before adding time or offset so impossible calendar dates never roll over.
    if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return invalid;
    let hour = 0, minute = 0, second = 0, millisecond = 0, zone;
    if (tail) {
      const time = tail.match(/^[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(AM|PM)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
      if (!time) return invalid;
      hour = Number(time[1]); minute = Number(time[2]); second = Number(time[3] || 0);
      millisecond = Number((time[4] || "").slice(0, 3).padEnd(3, "0"));
      if (time[5]) {
        if (hour < 1 || hour > 12) return invalid;
        hour = hour % 12 + (time[5].toUpperCase() === "PM" ? 12 : 0);
      }
      if (hour > 23 || minute > 59 || second > 59) return invalid;
      zone = time[6];
    }
    date.setUTCHours(hour, minute, second, millisecond);
    if (zone && zone.toUpperCase() !== "Z") {
      const offset = zone.match(/^([+-])(\d{2}):?(\d{2})$/);
      if (Number(offset[2]) > 23 || Number(offset[3]) > 59) return invalid;
      date.setTime(date.getTime() - (offset[1] === "+" ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000);
    }
    return { value: date.toISOString(), ...(!zone ? { warning: "source creation date has no timezone; interpreted as UTC." } : {}) };
  };
}

function inspectRows(rows, locale) {
  const parseDate = sourceDateParser(locale);
  const counts = new Map();
  for (const row of rows) counts.set(row.meta_lead_id, (counts.get(row.meta_lead_id) || 0) + 1);
  return rows.map((row, index) => {
    const errors = [];
    const warnings = [];
    const prefix = `Row ${index + 2}: `;
    if (!row.meta_lead_id) errors.push(prefix + "missing Lead ID; skipped.");
    else if (row.meta_lead_id.toLowerCase().startsWith("manual:")) errors.push(prefix + "reserved manual: Lead ID; skipped.");
    else if (counts.get(row.meta_lead_id) > 1) errors.push(prefix + "duplicate Lead ID; all occurrences skipped.");
    const date = parseDate(row.meta_created_at);
    if (date.error) errors.push(prefix + date.error);
    else row.meta_created_at = date.value;
    if (date.warning) warnings.push(prefix + date.warning);
    if (!row.name) warnings.push(prefix + "missing name.");
    if (!row.phone) warnings.push(prefix + "missing phone.");
    return { errors, warnings };
  });
}

// Dependencies are injected for isolated verification; importing this module never opens a database.
export function createSheetMappingService(dependencies = {}) {
  const readSheet = dependencies.readSheet || readGoogleSheet;
  const getMapping = dependencies.getSheetMapping || (async (...args) => (await import("./db.js")).getSheetMapping(...args));
  const saveMapping = dependencies.saveSheetMapping || (async (...args) => (await import("./db.js")).saveSheetMapping(...args));
  const importLead = dependencies.createLeadFromSource || (async (...args) => (await import("./db.js")).createLeadFromSource(...args));

  async function snapshot(full = false) {
    const sheet = await readSheet({ full, ...(dependencies.source ? { source: dependencies.source } : {}) });
    const saved = await getMapping(sheet.source.spreadsheetId, sheet.source.tabId);
    return { ...sheet, saved: saved ? structuredClone(saved) : null, headers: (sheet.rows[0] || []).map((header) => String(header ?? "")) };
  }

  function responseFor(state, mapping) {
    const resolution = resolveMapping(state.headers, mapping);
    const samples = state.rows.slice(1, 4).map((row) => mappedRow(resolution.indices, row));
    const checks = inspectRows(samples, state.locale);
    return {
      source: state.source, revision: state.saved?.revision ?? 0, fields, headers: state.headers,
      mapping: mapping ?? {}, resolved: resolution.resolved, samples, errors: resolution.errors,
      warnings: ["Preview checks only the first three data rows; sync validates every row.", ...checks.flatMap((check) => [...check.errors, ...check.warnings])]
    };
  }

  async function configure(body, userId, save) {
    const state = await snapshot();
    const response = responseFor(state, body?.mapping);
    let status = 400;
    if (!body?.source || body.source.spreadsheetId !== state.source.spreadsheetId || body.source.tabId !== state.source.tabId || body.source.title !== state.source.title) {
      response.errors.push("Sheet source changed. Reload the mapping before continuing.");
      status = 409;
    }
    if (!Number.isSafeInteger(body?.revision) || body.revision !== response.revision) {
      response.errors.push("Mapping revision changed. Reload the mapping before continuing.");
      status = 409;
    }
    const previous = resolveMapping(state.headers, state.saved?.mapping ?? null);
    if (previous.resolved.meta_lead_id !== response.resolved.meta_lead_id) response.warnings.push("Lead ID mapping changed. This can create new leads; existing populated CRM fields are not overwritten.");
    if (save && response.errors.length) throw mappingError(status, response.errors.join(" "), response);
    if (save) {
      response.revision = await saveMapping({ ...state.source, mapping: body.mapping, revision: body.revision, userId });
    }
    return response;
  }

  return {
    async get() {
      const state = await snapshot();
      return responseFor(state, state.saved?.mapping ?? null);
    },
    preview: (body) => configure(body, null, false),
    save: (body, userId) => configure(body, userId, true),
    async sync(userId = null) {
      let state;
      try { state = await snapshot(true); } catch (error) {
        if (error.configured === false) return { configured: false, created: 0, updated: 0, skipped: 0, failed: 0, message: error.message };
        throw error;
      }
      const resolution = resolveMapping(state.headers, state.saved?.mapping ?? null);
      if (resolution.errors.length) throw mappingError(400, resolution.errors.join(" "), responseFor(state, state.saved?.mapping ?? null));
      const rows = state.rows.slice(1).map((row) => mappedRow(resolution.indices, row));
      const checks = inspectRows(rows, state.locale);
      const result = { configured: true, source: state.source, revision: state.saved?.revision ?? 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [], warnings: [] };
      for (let index = 0; index < rows.length; index += 1) {
        result.warnings.push(...checks[index].warnings);
        if (checks[index].errors.length) {
          result.skipped += 1;
          result.errors.push(...checks[index].errors);
          continue;
        }
        try {
          const imported = await importLead({ ...rows[index], imported_from: "Google Sheet" }, userId);
          if (imported.created) result.created += 1;
          else if (imported.updated) result.updated += 1;
          else result.skipped += 1;
        } catch {
          result.failed += 1;
          result.errors.push(`Row ${index + 2}: import failed; rerun sync to retry safely.`);
        }
      }
      result.message = `Sync complete. Created ${result.created}, updated ${result.updated}, skipped ${result.skipped}, failed ${result.failed}.`;
      return result;
    }
  };
}

const mappingService = createSheetMappingService();
export const getGoogleSheetMapping = () => mappingService.get();
export const previewGoogleSheetMapping = (body) => mappingService.preview(body);
export const saveGoogleSheetMapping = (body, userId) => mappingService.save(body, userId);
export const syncGoogleSheet = (userId = null) => mappingService.sync(userId);

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

export function mapSheetRow(headers, row) {
  return mappedRow(resolveMapping(headers, null).indices, row);
}

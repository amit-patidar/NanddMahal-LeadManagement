import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "..", "crm.sqlite");
const isPostgres = Boolean(process.env.DATABASE_URL);

export const STATUSES = [
  "New",
  "Attempted",
  "Connected",
  "Follow Up",
  "Site Visit",
  "Super Interested",
  "Closed",
  "Rejected"
];

export const REJECTION_REASONS = [
  "Budget",
  "Location",
  "Not Interested",
  "Purchased Elsewhere",
  "Invalid Lead",
  "Other"
];

export const db = isPostgres
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
    })
  : new DatabaseSync(dbPath);

const nowIso = () => new Date().toISOString();
const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};
const toIso = (date, hour = 10) => {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export async function initDb() {
  if (isPostgres) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'sales',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        meta_lead_id TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        meta_created_at TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        campaign TEXT,
        looking_for TEXT,
        buy_plan TEXT,
        status TEXT NOT NULL,
        assigned_to INTEGER REFERENCES users(id),
        followup_date TEXT,
        followup_time TEXT,
        site_visit_date TEXT,
        site_visit_time TEXT,
        site_visit_completed_at TEXT,
        last_activity_at TEXT NOT NULL,
        last_comment TEXT,
        rejection_reason TEXT,
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS lead_activities (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        activity_type TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        comment TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        provider_message_id TEXT,
        direction TEXT NOT NULL,
        message_type TEXT NOT NULL,
        template_name TEXT,
        body TEXT,
        phone TEXT,
        status TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        sent_by_user_id INTEGER REFERENCES users(id),
        raw_payload TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        delivered_at TEXT,
        read_at TEXT,
        failed_at TEXT,
        UNIQUE (provider, provider_message_id)
      );

      CREATE TABLE IF NOT EXISTS whatsapp_events (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        event_key TEXT NOT NULL UNIQUE,
        provider_message_id TEXT,
        lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        raw_payload TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed_at TEXT,
        processing_status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_leads_followup_date ON leads(followup_date);
      CREATE INDEX IF NOT EXISTS idx_leads_site_visit_date ON leads(site_visit_date);
      CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON lead_activities(lead_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id ON whatsapp_messages(lead_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(phone);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_events_lead_id ON whatsapp_events(lead_id);
    `);
  } else {
    db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'sales',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meta_lead_id TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        meta_created_at TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        campaign TEXT,
        looking_for TEXT,
        buy_plan TEXT,
        status TEXT NOT NULL,
        assigned_to INTEGER,
        followup_date TEXT,
        followup_time TEXT,
        site_visit_date TEXT,
        site_visit_time TEXT,
        site_visit_completed_at TEXT,
        last_activity_at TEXT NOT NULL,
        last_comment TEXT,
        rejection_reason TEXT,
        closed_at TEXT,
        FOREIGN KEY (assigned_to) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS lead_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL,
        user_id INTEGER,
        activity_type TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        comment TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER,
        provider TEXT NOT NULL,
        provider_message_id TEXT,
        direction TEXT NOT NULL,
        message_type TEXT NOT NULL,
        template_name TEXT,
        body TEXT,
        phone TEXT,
        status TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        sent_by_user_id INTEGER,
        raw_payload TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        delivered_at TEXT,
        read_at TEXT,
        failed_at TEXT,
        UNIQUE (provider, provider_message_id),
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
        FOREIGN KEY (sent_by_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS whatsapp_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        event_key TEXT NOT NULL UNIQUE,
        provider_message_id TEXT,
        lead_id INTEGER,
        event_type TEXT NOT NULL,
        raw_payload TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed_at TEXT,
        processing_status TEXT NOT NULL,
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_leads_followup_date ON leads(followup_date);
      CREATE INDEX IF NOT EXISTS idx_leads_site_visit_date ON leads(site_visit_date);
      CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON lead_activities(lead_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id ON whatsapp_messages(lead_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(phone);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_events_lead_id ON whatsapp_events(lead_id);
    `);

    await migrateSqlite();
  }

  await seedDb();
}

async function migrateSqlite() {
  const columns = (await all("PRAGMA table_info(leads)")).map((column) => column.name);
  if (!columns.includes("looking_for")) {
    db.exec("ALTER TABLE leads ADD COLUMN looking_for TEXT");
  }
  if (!columns.includes("buy_plan")) {
    db.exec("ALTER TABLE leads ADD COLUMN buy_plan TEXT");
  }
}

export async function all(sql, params = {}) {
  if (isPostgres) {
    const query = toPostgresQuery(sql, params);
    const result = await db.query(query.text, query.values);
    return result.rows;
  }
  return db.prepare(sql).all(bindParams(sql, params));
}

export async function get(sql, params = {}) {
  if (isPostgres) {
    const rows = await all(sql, params);
    return rows[0];
  }
  return db.prepare(sql).get(bindParams(sql, params));
}

export async function run(sql, params = {}) {
  if (isPostgres) {
    const pgSql = sql.replace(/INSERT OR IGNORE INTO/gi, "INSERT INTO");
    const query = toPostgresQuery(pgSql, params);
    const result = await db.query(query.text, query.values);
    return { changes: result.rowCount, rowCount: result.rowCount };
  }
  return db.prepare(sql).run(bindParams(sql, params));
}

function bindParams(sql, params) {
  const names = [...sql.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
  return names.reduce((bound, name) => {
    if (Object.hasOwn(params, name)) bound[name] = params[name];
    return bound;
  }, {});
}

function toPostgresQuery(sql, params = {}) {
  const values = [];
  const seen = new Map();
  const text = sql.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
    if (!seen.has(name)) {
      values.push(params[name]);
      seen.set(name, values.length);
    }
    return `$${seen.get(name)}`;
  }).replace(/date\(([^)]+)\)/gi, "DATE($1)");
  return { text, values };
}

export async function addActivity({ leadId, userId = null, activityType, oldValue = null, newValue = null, comment = null }) {
  const createdAt = nowIso();
  await run(
    `INSERT INTO lead_activities
      (lead_id, user_id, activity_type, old_value, new_value, comment, created_at)
     VALUES (:leadId, :userId, :activityType, :oldValue, :newValue, :comment, :createdAt)`,
    { leadId, userId, activityType, oldValue, newValue, comment, createdAt }
  );
  await run(
    `UPDATE leads
     SET last_activity_at = :createdAt,
         last_comment = COALESCE(:comment, last_comment)
     WHERE id = :leadId`,
    { leadId, createdAt, comment }
  );
}

export async function whatsappMessagesForLead(leadId) {
  return all(
    `SELECT *
     FROM whatsapp_messages
     WHERE lead_id = :leadId
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    { leadId }
  );
}

export async function findLeadByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const rows = await all("SELECT * FROM leads WHERE phone IS NOT NULL");
  return rows.find((lead) => normalizePhone(lead.phone) === normalized) || null;
}

export async function recordWhatsAppEvent(event) {
  const receivedAt = event.receivedAt || nowIso();
  const processedAt = event.processedAt || nowIso();
  const params = {
    provider: event.provider || "meta",
    eventKey: event.eventKey,
    providerMessageId: event.providerMessageId || null,
    leadId: event.leadId || null,
    eventType: event.eventType,
    rawPayload: JSON.stringify(event.rawPayload || {}),
    receivedAt,
    processedAt,
    processingStatus: event.processingStatus || "processed"
  };

  const sql = isPostgres
    ? `INSERT INTO whatsapp_events
        (provider, event_key, provider_message_id, lead_id, event_type, raw_payload, received_at, processed_at, processing_status)
       VALUES
        (:provider, :eventKey, :providerMessageId, :leadId, :eventType, :rawPayload, :receivedAt, :processedAt, :processingStatus)
       ON CONFLICT (event_key) DO NOTHING`
    : `INSERT OR IGNORE INTO whatsapp_events
        (provider, event_key, provider_message_id, lead_id, event_type, raw_payload, received_at, processed_at, processing_status)
       VALUES
        (:provider, :eventKey, :providerMessageId, :leadId, :eventType, :rawPayload, :receivedAt, :processedAt, :processingStatus)`;

  return run(sql, params);
}

export async function recordWhatsAppMessage(message) {
  const createdAt = message.createdAt || nowIso();
  const sentAt = message.sentAt || null;
  const params = {
    leadId: message.leadId || null,
    provider: message.provider || "meta",
    providerMessageId: message.providerMessageId || null,
    direction: message.direction,
    messageType: message.messageType || "text",
    templateName: message.templateName || null,
    body: message.body || null,
    phone: message.phone || null,
    status: message.status,
    errorCode: message.errorCode || null,
    errorMessage: message.errorMessage || null,
    sentByUserId: message.sentByUserId || null,
    rawPayload: JSON.stringify(message.rawPayload || {}),
    createdAt,
    sentAt,
    deliveredAt: message.deliveredAt || null,
    readAt: message.readAt || null,
    failedAt: message.failedAt || null
  };

  const sql = isPostgres
    ? `INSERT INTO whatsapp_messages
        (lead_id, provider, provider_message_id, direction, message_type, template_name, body, phone, status, error_code, error_message, sent_by_user_id, raw_payload, created_at, sent_at, delivered_at, read_at, failed_at)
       VALUES
        (:leadId, :provider, :providerMessageId, :direction, :messageType, :templateName, :body, :phone, :status, :errorCode, :errorMessage, :sentByUserId, :rawPayload, :createdAt, :sentAt, :deliveredAt, :readAt, :failedAt)
       ON CONFLICT (provider, provider_message_id) DO UPDATE SET
        lead_id = COALESCE(EXCLUDED.lead_id, whatsapp_messages.lead_id),
        status = EXCLUDED.status,
        error_code = EXCLUDED.error_code,
        error_message = EXCLUDED.error_message,
        raw_payload = EXCLUDED.raw_payload,
        sent_at = COALESCE(EXCLUDED.sent_at, whatsapp_messages.sent_at),
        delivered_at = COALESCE(EXCLUDED.delivered_at, whatsapp_messages.delivered_at),
        read_at = COALESCE(EXCLUDED.read_at, whatsapp_messages.read_at),
        failed_at = COALESCE(EXCLUDED.failed_at, whatsapp_messages.failed_at)`
    : `INSERT INTO whatsapp_messages
        (lead_id, provider, provider_message_id, direction, message_type, template_name, body, phone, status, error_code, error_message, sent_by_user_id, raw_payload, created_at, sent_at, delivered_at, read_at, failed_at)
       VALUES
        (:leadId, :provider, :providerMessageId, :direction, :messageType, :templateName, :body, :phone, :status, :errorCode, :errorMessage, :sentByUserId, :rawPayload, :createdAt, :sentAt, :deliveredAt, :readAt, :failedAt)
       ON CONFLICT(provider, provider_message_id) DO UPDATE SET
        lead_id = COALESCE(excluded.lead_id, whatsapp_messages.lead_id),
        status = excluded.status,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        raw_payload = excluded.raw_payload,
        sent_at = COALESCE(excluded.sent_at, whatsapp_messages.sent_at),
        delivered_at = COALESCE(excluded.delivered_at, whatsapp_messages.delivered_at),
        read_at = COALESCE(excluded.read_at, whatsapp_messages.read_at),
        failed_at = COALESCE(excluded.failed_at, whatsapp_messages.failed_at)`;

  return run(sql, params);
}

export function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length > 10 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export async function createLeadFromSource(source, userId = null) {
  const now = nowIso();
  const metaCreatedAt = source.meta_created_at || source.metaCreatedAt || now;
  const info = {
    metaLeadId: String(source.meta_lead_id || source.metaLeadId || "").trim(),
    name: source.name || "Unknown Lead",
    phone: source.phone || "",
    email: source.email || null,
    campaign: source.campaign || source.project || "Meta Campaign",
    lookingFor: source.looking_for || source.lookingFor || null,
    buyPlan: source.buy_plan || source.buyPlan || null,
    metaCreatedAt,
    createdAt: now,
    lastActivityAt: now
  };

  if (!info.metaLeadId) {
    throw new Error("Meta Lead ID is required");
  }

  const insertSql = isPostgres
    ? `INSERT INTO leads
        (meta_lead_id, created_at, meta_created_at, name, phone, email, campaign, looking_for, buy_plan, status, last_activity_at)
       VALUES
        (:metaLeadId, :createdAt, :metaCreatedAt, :name, :phone, :email, :campaign, :lookingFor, :buyPlan, 'New', :lastActivityAt)
       ON CONFLICT (meta_lead_id) DO NOTHING`
    : `INSERT OR IGNORE INTO leads
        (meta_lead_id, created_at, meta_created_at, name, phone, email, campaign, looking_for, buy_plan, status, last_activity_at)
       VALUES
        (:metaLeadId, :createdAt, :metaCreatedAt, :name, :phone, :email, :campaign, :lookingFor, :buyPlan, 'New', :lastActivityAt)`;

  const result = await run(insertSql, info);

  if (result.changes > 0 || result.rowCount > 0) {
    const lead = await get("SELECT id FROM leads WHERE meta_lead_id = :metaLeadId", { metaLeadId: info.metaLeadId });
    await addActivity({
      leadId: lead.id,
      userId,
      activityType: "Lead Created",
      newValue: "New",
      comment: `Imported from ${source.imported_from || "source"}`
    });
    return { created: true, leadId: lead.id };
  }

  const existing = await get("SELECT id FROM leads WHERE meta_lead_id = :metaLeadId", { metaLeadId: info.metaLeadId });
  if (existing?.id) {
    const updated = await updateMissingLeadFields(existing.id, info, userId);
    return { created: false, updated, leadId: existing.id };
  }

  return { created: false, updated: false, leadId: existing?.id };
}

async function updateMissingLeadFields(leadId, info, userId) {
  const lead = await get("SELECT * FROM leads WHERE id = :leadId", { leadId });
  if (!lead) return false;

  const updates = {
    leadId,
    name: shouldFill(lead.name, "Unknown Lead") ? info.name : lead.name,
    phone: shouldFill(lead.phone) ? info.phone : lead.phone,
    email: shouldFill(lead.email) ? info.email : lead.email,
    campaign: shouldFill(lead.campaign, "Meta Campaign") ? info.campaign : lead.campaign,
    lookingFor: shouldFill(lead.looking_for) ? info.lookingFor : lead.looking_for,
    buyPlan: shouldFill(lead.buy_plan) ? info.buyPlan : lead.buy_plan,
    metaCreatedAt: shouldFill(lead.meta_created_at) ? info.metaCreatedAt : lead.meta_created_at
  };

  const changed = updates.name !== lead.name ||
    updates.phone !== lead.phone ||
    updates.email !== lead.email ||
    updates.campaign !== lead.campaign ||
    updates.lookingFor !== lead.looking_for ||
    updates.buyPlan !== lead.buy_plan ||
    updates.metaCreatedAt !== lead.meta_created_at;

  if (!changed) return false;

  await run(
    `UPDATE leads
     SET name = :name,
         phone = :phone,
         email = :email,
         campaign = :campaign,
         looking_for = :lookingFor,
         buy_plan = :buyPlan,
         meta_created_at = :metaCreatedAt
     WHERE id = :leadId`,
    updates
  );
  await addActivity({
    leadId,
    userId,
    activityType: "Sync Updated",
    comment: "Filled missing source fields from Google Sheet"
  });
  return true;
}

function shouldFill(current, placeholder = "") {
  return current == null || String(current).trim() === "" || (placeholder && current === placeholder);
}

async function seedDb() {
  const userCount = (await get("SELECT COUNT(*) AS count FROM users")).count;
  if (Number(userCount) > 0) return;

  await run(
    "INSERT INTO users (name, email, password, role) VALUES (:name, :email, :password, :role)",
    { name: "Amit Patidar", email: "amitpatidar.7492@gmail.com", password: "@NanddMahal", role: "admin" }
  );
  await run(
    "INSERT INTO users (name, email, password, role) VALUES (:name, :email, :password, :role)",
    { name: "K Sengar", email: "Ksengar413@gmail.com", password: "@NanddMahal", role: "sales" }
  );
}

export function dateOnly(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

export function tomorrowDate() {
  return dateOnly(addDays(1));
}

export function monthStart() {
  const d = new Date();
  d.setDate(1);
  return dateOnly(d);
}

export function sevenDaysAgo() {
  return dateOnly(addDays(-6));
}

export function yesterdayDate() {
  return dateOnly(addDays(-1));
}

export function isoNow() {
  return nowIso();
}

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

      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_leads_followup_date ON leads(followup_date);
      CREATE INDEX IF NOT EXISTS idx_leads_site_visit_date ON leads(site_visit_date);
      CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON lead_activities(lead_id);
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

      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_leads_followup_date ON leads(followup_date);
      CREATE INDEX IF NOT EXISTS idx_leads_site_visit_date ON leads(site_visit_date);
      CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON lead_activities(lead_id);
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

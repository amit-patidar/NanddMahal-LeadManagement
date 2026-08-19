import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import {
  STATUSES,
  REJECTION_REASONS,
  addActivity,
  all,
  dateOnly,
  get,
  initDb,
  isoNow,
  monthStart,
  run,
  sevenDaysAgo,
  tomorrowDate,
  yesterdayDate
} from "./db.js";
import {
  authenticateUser,
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionUser,
  publicUser,
  setSessionCookie
} from "./auth.js";
import { hashPassword } from "./passwords.js";
import { syncGoogleSheet } from "./sheetsSync.js";
import { cloudinaryStatus, listWhatsAppMedia, uploadWhatsAppMedia } from "./cloudinaryMedia.js";
import { verifyMetaChallenge, verifyMetaSignature } from "./whatsappProvider.js";
import { parseMetaWebhook } from "./whatsappWebhook.js";
import {
  getApprovedMetaTemplates,
  processWhatsAppEvents,
  sendLeadWhatsAppText,
  sendLeadWhatsAppTemplate,
  whatsAppReplyWindowForLead,
  whatsappMessagesForLead,
  whatsappStatus
} from "./whatsappService.js";

const PORT = Number(process.env.PORT || 4000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

await initDb();

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") {
      return json(res, 204, {});
    }

    if (!url.pathname.startsWith("/api")) {
      return serveStatic(res, url.pathname);
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/webhooks/whatsapp/meta") {
      const verification = verifyMetaChallenge(url.searchParams);
      if (!verification.ok) return text(res, 403, "Webhook verification failed");
      return text(res, 200, verification.challenge);
    }

    if (req.method === "POST" && url.pathname === "/api/webhooks/whatsapp/meta") {
      const rawBody = await readRaw(req);
      const signature = req.headers["x-hub-signature-256"];
      if (!verifyMetaSignature(rawBody, Array.isArray(signature) ? signature[0] : signature)) {
        return json(res, 403, { error: "Invalid WhatsApp webhook signature" });
      }
      const payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
      const events = parseMetaWebhook(payload);
      const results = await processWhatsAppEvents(events);
      return json(res, 200, { ok: true, received: events.length, results });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJson(req);
      const user = await authenticateUser(body.identifier || body.email || body.username, body.password);
      if (!user) return json(res, 401, { error: "Invalid username or password" });
      setSessionCookie(res, await createSession(user.id));
      return json(res, 200, { user });
    }

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      const user = await getSessionUser(req);
      if (!user) return json(res, 401, { error: "Authentication required" });
      return json(res, 200, { user });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      await destroySession(req);
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    const user = await getSessionUser(req);
    if (!user) return json(res, 401, { error: "Authentication required" });

    if (req.method === "GET" && url.pathname === "/api/whatsapp/status") {
      return json(res, 200, { ...whatsappStatus(), mediaLibrary: cloudinaryStatus() });
    }

    if (req.method === "GET" && url.pathname === "/api/whatsapp/templates") {
      return json(res, 200, await getApprovedMetaTemplates());
    }

    if (req.method === "POST" && url.pathname === "/api/whatsapp/templates/refresh") {
      return json(res, 200, await getApprovedMetaTemplates({ force: true }));
    }

    if (req.method === "GET" && url.pathname === "/api/whatsapp/media") {
      return json(res, 200, await listWhatsAppMedia());
    }

    if (req.method === "POST" && url.pathname === "/api/whatsapp/media") {
      const rawBody = await readRaw(req, 6 * 1024 * 1024);
      const upload = parseMultipartUpload(rawBody, req.headers["content-type"] || "");
      if (!upload.file) throw new Error("Image file is required.");
      const asset = await uploadWhatsAppMedia({ file: upload.file, userId: user.id });
      return json(res, 200, asset);
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      requireAdmin(user);
      return json(res, 200, await all("SELECT id, name, email, role, active FROM users ORDER BY id"));
    }

    if (req.method === "POST" && url.pathname === "/api/users") {
      requireAdmin(user);
      const body = await readJson(req);
      return json(res, 201, { user: await createUser(body) });
    }

    const userMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
    if (req.method === "PATCH" && userMatch) {
      requireAdmin(user);
      const body = await readJson(req);
      return json(res, 200, { user: await updateUser(Number(userMatch[1]), body, user) });
    }

    if (req.method === "GET" && url.pathname === "/api/meta") {
      return json(res, 200, { statuses: STATUSES, rejectionReasons: REJECTION_REASONS });
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      return json(res, 200, await dashboardCounts(user));
    }

    if (req.method === "GET" && url.pathname === "/api/leads") {
      return json(res, 200, await listLeads(Object.fromEntries(url.searchParams.entries()), user));
    }

    const leadMatch = url.pathname.match(/^\/api\/leads\/(\d+)$/);
    if (req.method === "GET" && leadMatch) {
      const id = Number(leadMatch[1]);
      const lead = await leadById(id);
      assertLeadAccess(lead, user);
      const activities = await all(
        `SELECT a.*, u.name AS user_name
         FROM lead_activities a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.lead_id = :id
         ORDER BY a.created_at DESC, a.id DESC`,
        { id }
      );
      return json(res, 200, { lead, activities });
    }

    const leadWhatsAppMessagesMatch = url.pathname.match(/^\/api\/leads\/(\d+)\/whatsapp\/messages$/);
    if (req.method === "GET" && leadWhatsAppMessagesMatch) {
      const id = Number(leadWhatsAppMessagesMatch[1]);
      assertLeadAccess(await leadById(id), user);
      const messages = await whatsappMessagesForLead(id);
      const replyWindow = await whatsAppReplyWindowForLead(id);
      return json(res, 200, { messages, replyWindow });
    }

    const leadWhatsAppTextMatch = url.pathname.match(/^\/api\/leads\/(\d+)\/whatsapp\/messages$/);
    if (req.method === "POST" && leadWhatsAppTextMatch) {
      const id = Number(leadWhatsAppTextMatch[1]);
      const body = await readJson(req);
      assertLeadAccess(await leadById(id), user);
      const result = await sendLeadWhatsAppText({
        leadId: id,
        userId: user.id,
        body: body.text || body.body || ""
      });
      return json(res, 200, result);
    }

    const leadWhatsAppSendMatch = url.pathname.match(/^\/api\/leads\/(\d+)\/whatsapp\/send$/);
    if (req.method === "POST" && leadWhatsAppSendMatch) {
      const id = Number(leadWhatsAppSendMatch[1]);
      const body = await readJson(req);
      assertLeadAccess(await leadById(id), user);
      const result = await sendLeadWhatsAppTemplate({
        leadId: id,
        userId: user.id,
        templateName: body.templateName,
        language: body.language || "en",
        parameters: Array.isArray(body.parameters) ? body.parameters : [],
        headerImageUrl: body.headerImageUrl || ""
      });
      return json(res, 200, result);
    }

    if (req.method === "POST" && leadMatch) {
      const id = Number(leadMatch[1]);
      const body = await readJson(req);
      assertLeadAccess(await leadById(id), user);
      return json(res, 200, await updateLead(id, body, user));
    }

    if (req.method === "POST" && url.pathname === "/api/sync") {
      requireAdmin(user);
      const result = await syncGoogleSheet(user.id);
      return json(res, 200, result);
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    if (!(error instanceof HttpError && error.status < 500)) console.error(error);
    return json(res, error.status || 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`CRM API running on http://localhost:${PORT}`);
});

async function createUser(body) {
  const name = String(body.name || "").trim();
  const email = String(body.email || body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = body.role || "sales";
  if (!name || !email || !password) throw new HttpError(400, "Name, username/email, and password are required.");
  if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters.");
  if (!email.includes("@")) throw new HttpError(400, "Username must be a valid email address.");
  if (!["admin", "sales"].includes(role)) throw new HttpError(400, "Invalid user role.");

  const existing = await get("SELECT id FROM users WHERE LOWER(email) = :email", { email });
  if (existing) throw new HttpError(409, "A user with this username/email already exists.");

  const credentials = hashPassword(password);
  const active = body.active === false ? (isPostgresBoolean() ? false : 0) : (isPostgresBoolean() ? true : 1);
  await run(
    `INSERT INTO users (name, email, password_hash, password_salt, role, active)
     VALUES (:name, :email, :passwordHash, :passwordSalt, :role, :active)`,
    { name, email, passwordHash: credentials.hash, passwordSalt: credentials.salt, role, active }
  );
  return publicUser(await get("SELECT id, name, email, role, active FROM users WHERE LOWER(email) = :email", { email }));
}

async function updateUser(id, body, actor) {
  const target = await get("SELECT id, name, email, role, active FROM users WHERE id = :id", { id });
  if (!target) throw new HttpError(404, "User not found.");

  if (body.active === false && Number(target.id) === Number(actor.id)) {
    throw new HttpError(400, "You cannot deactivate your own account.");
  }
  if (body.active === false && target.role === "admin") {
    const adminCount = await scalar("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active");
    if (adminCount <= 1) throw new HttpError(400, "At least one active administrator is required.");
  }

  if (Object.hasOwn(body, "password")) {
    const password = String(body.password || "");
    if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters.");
    const credentials = hashPassword(password);
    await run(
      `UPDATE users
       SET password_hash = :passwordHash,
           password_salt = :passwordSalt
       WHERE id = :id`,
      { id, passwordHash: credentials.hash, passwordSalt: credentials.salt }
    );
  }

  if (Object.hasOwn(body, "active")) {
    await run("UPDATE users SET active = :active WHERE id = :id", {
      id,
      active: body.active ? (isPostgresBoolean() ? true : 1) : (isPostgresBoolean() ? false : 0)
    });
  }

  return publicUser(await get("SELECT id, name, email, role, active FROM users WHERE id = :id", { id }));
}

function isPostgresBoolean() {
  return Boolean(process.env.DATABASE_URL);
}

async function dashboardCounts(user) {
  const today = dateOnly();
  const params = {
    today,
    cutoff: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  };
  const scope = user.role === "admin" ? "" : " AND assigned_to = :accessUserId";
  if (user.role !== "admin") params.accessUserId = user.id;
  return {
    newLeads: await scalar(`SELECT COUNT(*) FROM leads WHERE status = 'New'${scope}`, params),
    attemptedLeads: await scalar(`SELECT COUNT(*) FROM leads WHERE status = 'Attempted'${scope}`, params),
    missedLeads: await scalar(
      `SELECT COUNT(*) FROM leads
       WHERE status IN ('New', 'Attempted')
       AND last_activity_at < :cutoff
       AND followup_date IS NULL
       AND site_visit_date IS NULL${scope}`,
      params
    ),
    todaysFollowups: await scalar(`SELECT COUNT(*) FROM leads WHERE status = 'Follow Up' AND followup_date = :today${scope}`, params),
    missedFollowups: await scalar(`SELECT COUNT(*) FROM leads WHERE status = 'Follow Up' AND followup_date < :today${scope}`, params),
    todaysSiteVisits: await scalar(`SELECT COUNT(*) FROM leads WHERE status = 'Site Visit' AND site_visit_date = :today${scope}`, params),
    missedSiteVisits: await scalar(
      `SELECT COUNT(*) FROM leads
       WHERE status = 'Site Visit'
       AND site_visit_date < :today
       AND site_visit_completed_at IS NULL${scope}`,
      params
    ),
    superInterested: await scalar(`SELECT COUNT(*) FROM leads WHERE status = 'Super Interested'${scope}`, params)
  };
}

async function listLeads(query, user) {
  const clauses = [];
  const params = {
    today: dateOnly(),
    tomorrow: tomorrowDate(),
    yesterday: yesterdayDate(),
    sevenDaysAgo: sevenDaysAgo(),
    monthStart: monthStart(),
    cutoff: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  };

  if (user.role !== "admin") {
    clauses.push("l.assigned_to = :accessUserId");
    params.accessUserId = user.id;
  } else if (query.view === "my" && query.userId) {
    clauses.push("l.assigned_to = :userId");
    params.userId = Number(query.userId);
  }
  if (query.status) {
    clauses.push("l.status = :status");
    params.status = query.status;
  }
  if (user.role === "admin" && query.assignedTo) {
    clauses.push("l.assigned_to = :assignedTo");
    params.assignedTo = Number(query.assignedTo);
  }
  if (query.search) {
    clauses.push(`(
      LOWER(l.name) LIKE :search
      OR l.phone LIKE :search
      OR LOWER(COALESCE(l.email, '')) LIKE :search
      OR LOWER(l.meta_lead_id) LIKE :search
      OR LOWER(COALESCE(l.last_comment, '')) LIKE :search
      OR EXISTS (
        SELECT 1
        FROM lead_activities search_activity
        WHERE search_activity.lead_id = l.id
          AND LOWER(COALESCE(search_activity.comment, '')) LIKE :search
      )
    )`);
    params.search = `%${query.search.toLowerCase()}%`;
  }

  applyView(query, clauses, params);
  applyDatePreset(query, clauses, params);

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const matchedComment = query.search
    ? `,
       CASE
         WHEN LOWER(COALESCE(l.last_comment, '')) LIKE :search THEN l.last_comment
         ELSE (
           SELECT search_activity.comment
           FROM lead_activities search_activity
           WHERE search_activity.lead_id = l.id
             AND LOWER(COALESCE(search_activity.comment, '')) LIKE :search
           ORDER BY search_activity.created_at DESC, search_activity.id DESC
           LIMIT 1
         )
       END AS matched_comment`
    : "";
  return all(
    `SELECT l.*, u.name AS assigned_name${matchedComment}
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to
     ${where}
     ORDER BY l.last_activity_at DESC, l.created_at DESC
     LIMIT 300`,
    params
  );
}

function applyView(query, clauses, params) {
  if (query.list === "new") clauses.push("l.status = 'New'");
  if (query.list === "attempted") clauses.push("l.status = 'Attempted'");
  if (query.list === "super") clauses.push("l.status = 'Super Interested'");
  if (query.list === "rejected") clauses.push("l.status = 'Rejected'");
  if (query.list === "followups") clauses.push("l.status = 'Follow Up'");
  if (query.list === "sitevisits") clauses.push("l.status = 'Site Visit'");
  if (query.list === "missed-leads") {
    clauses.push(`l.status IN ('New', 'Attempted')`);
    clauses.push("l.last_activity_at < :cutoff");
    clauses.push("l.followup_date IS NULL");
    clauses.push("l.site_visit_date IS NULL");
  }
  if (query.list === "missed-followups") {
    clauses.push("l.status = 'Follow Up'");
    clauses.push("l.followup_date < :today");
  }
  if (query.list === "missed-sitevisits") {
    clauses.push("l.status = 'Site Visit'");
    clauses.push("l.site_visit_date < :today");
    clauses.push("l.site_visit_completed_at IS NULL");
  }
  if (query.dateFilter === "today") {
    clauses.push(dateField(query) + " = :today");
  }
  if (query.dateFilter === "tomorrow") {
    clauses.push(dateField(query) + " = :tomorrow");
  }
  if (query.dateFilter === "upcoming") {
    clauses.push(dateField(query) + " > :today");
  }
  if (query.dateFilter === "missed") {
    clauses.push(dateField(query) + " < :today");
  }
}

function applyDatePreset(query, clauses, params) {
  const fieldMap = {
    created: "date(l.created_at)",
    followup: "l.followup_date",
    sitevisit: "l.site_visit_date"
  };
  const field = fieldMap[query.dateField || "created"];
  if (!query.preset || !field) return;
  if (query.preset === "today") clauses.push(`${field} = :today`);
  if (query.preset === "yesterday") clauses.push(`${field} = :yesterday`);
  if (query.preset === "last7") clauses.push(`${field} BETWEEN :sevenDaysAgo AND :today`);
  if (query.preset === "month") clauses.push(`${field} BETWEEN :monthStart AND :today`);
  if (query.preset === "custom" && query.from && query.to) {
    clauses.push(`${field} BETWEEN :fromDate AND :toDate`);
    params.fromDate = query.from;
    params.toDate = query.to;
  }
}

function dateField(query) {
  return query.list === "sitevisits" || query.list === "missed-sitevisits" ? "l.site_visit_date" : "l.followup_date";
}

async function updateLead(id, body, user) {
  const lead = await leadById(id);
  if (!lead) throw new Error("Lead not found");

  if (body.action === "assignToMe") {
    await run("UPDATE leads SET assigned_to = :userId WHERE id = :id", { id, userId: user.id });
    await addActivity({ leadId: id, userId: user.id, activityType: "Assigned", oldValue: lead.assigned_name, newValue: user.name, comment: "Assigned to me" });
    return leadById(id);
  }

  if (body.action === "assign") {
    requireAdmin(user);
    const assignedTo = body.assignedTo ? Number(body.assignedTo) : null;
    const assignee = assignedTo ? await get("SELECT id, name FROM users WHERE id = :id AND active", { id: assignedTo }) : null;
    if (assignedTo && !assignee) throw new HttpError(400, "Assigned user is not active or does not exist.");
    await run("UPDATE leads SET assigned_to = :assignedTo WHERE id = :id", { id, assignedTo });
    await addActivity({
      leadId: id,
      userId: user.id,
      activityType: "Assigned",
      oldValue: lead.assigned_name || "Unassigned",
      newValue: assignee?.name || "Unassigned",
      comment: "Assignment updated by admin"
    });
    return leadById(id);
  }

  if (body.action === "comment") {
    await addActivity({ leadId: id, userId: user.id, activityType: "Comment Added", comment: body.comment || "" });
    return leadById(id);
  }

  if (body.action === "siteVisited") {
    await run("UPDATE leads SET site_visit_completed_at = :now WHERE id = :id", { id, now: isoNow() });
    await addActivity({ leadId: id, userId: user.id, activityType: "Site Visit Completed", comment: body.comment || "Site visit marked complete" });
    return leadById(id);
  }

  if (body.action === "status") {
    if (!STATUSES.includes(body.status)) throw new Error("Invalid status");
    let assignedTo = lead.assigned_to;
    if (user.role === "admin" && Object.hasOwn(body, "assignedTo")) {
      assignedTo = body.assignedTo ? Number(body.assignedTo) : null;
      const assignee = assignedTo ? await get("SELECT id FROM users WHERE id = :id AND active", { id: assignedTo }) : null;
      if (assignedTo && !assignee) throw new HttpError(400, "Assigned user is not active or does not exist.");
    }
    const updates = {
      id,
      status: body.status,
      assignedTo,
      followupDate: body.followupDate || null,
      followupTime: body.followupTime || null,
      siteVisitDate: body.siteVisitDate || null,
      siteVisitTime: body.siteVisitTime || null,
      rejectionReason: body.rejectionReason || null,
      closedAt: body.status === "Closed" ? isoNow() : lead.closed_at,
      completedAt: body.status === "Site Visit" ? null : lead.site_visit_completed_at
    };
    await run(
      `UPDATE leads
       SET status = :status,
           assigned_to = :assignedTo,
           followup_date = :followupDate,
           followup_time = :followupTime,
           site_visit_date = :siteVisitDate,
           site_visit_time = :siteVisitTime,
           site_visit_completed_at = :completedAt,
           rejection_reason = :rejectionReason,
           closed_at = :closedAt
       WHERE id = :id`,
      updates
    );
    await addActivity({
      leadId: id,
      userId: user.id,
      activityType: activityForStatus(body.status, lead.status, body),
      oldValue: lead.status,
      newValue: body.status,
      comment: body.comment || null
    });
    return leadById(id);
  }

  throw new Error("Unsupported action");
}

function activityForStatus(status, previous, body) {
  if (status === "Attempted") return "Attempted";
  if (status === "Connected") return "Connected";
  if (status === "Follow Up") return previous === "Follow Up" ? "Follow-up Rescheduled" : "Follow-up Created";
  if (status === "Site Visit") return previous === "Site Visit" ? "Site Visit Rescheduled" : "Site Visit Scheduled";
  if (status === "Rejected") return "Lead Rejected";
  if (status === "Closed") return "Lead Closed";
  return "Status Changed";
}

async function leadById(id) {
  return get(
    `SELECT l.*, u.name AS assigned_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to
     WHERE l.id = :id`,
    { id }
  );
}

function requireAdmin(user) {
  if (user.role !== "admin") throw new HttpError(403, "Administrator access required.");
}

function assertLeadAccess(lead, user) {
  if (!lead) throw new HttpError(404, "Lead not found");
  if (user.role !== "admin" && Number(lead.assigned_to) !== Number(user.id)) {
    throw new HttpError(403, "You can only access leads assigned to you.");
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function scalar(sql, params = {}) {
  const row = await get(sql, params);
  return Number(row.count ?? row["COUNT(*)"] ?? 0);
}

async function readJson(req) {
  const raw = await readRaw(req);
  return raw.length ? JSON.parse(raw.toString("utf8")) : {};
}

async function readRaw(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-user-id,x-hub-signature-256"
  });
  res.end(JSON.stringify(payload));
}

function text(res, status, payload) {
  res.writeHead(status, {
    "content-type": "text/plain",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-user-id,x-hub-signature-256"
  });
  res.end(String(payload));
}

function parseMultipartUpload(rawBody, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("Multipart boundary is missing.");
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const parts = rawBody.toString("binary").split(boundary).slice(1, -1);
  const fields = {};
  let file = null;

  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const splitIndex = trimmed.indexOf("\r\n\r\n");
    if (splitIndex < 0) continue;
    const rawHeaders = trimmed.slice(0, splitIndex);
    let body = trimmed.slice(splitIndex + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    const headers = Object.fromEntries(rawHeaders.split("\r\n").map((line) => {
      const index = line.indexOf(":");
      return index >= 0 ? [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()] : [line.toLowerCase(), ""];
    }));
    const disposition = headers["content-disposition"] || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    if (!name) continue;

    if (filename) {
      file = {
        fieldName: name,
        filename,
        contentType: headers["content-type"] || "application/octet-stream",
        buffer: Buffer.from(body, "binary")
      };
    } else {
      fields[name] = Buffer.from(body, "binary").toString("utf8");
    }
  }

  return { fields, file };
}

async function serveStatic(res, pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(distDir, safePath);
  const targetPath = filePath.startsWith(distDir) ? filePath : path.join(distDir, "index.html");

  try {
    const content = await fs.readFile(targetPath);
    res.writeHead(200, { "content-type": contentType(targetPath) });
    res.end(content);
  } catch {
    try {
      const fallback = await fs.readFile(path.join(distDir, "index.html"));
      res.writeHead(200, { "content-type": "text/html" });
      res.end(fallback);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Build output not found. Run npm run build first.");
    }
  }
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

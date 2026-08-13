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
import { syncGoogleSheet } from "./sheetsSync.js";
import { verifyMetaChallenge, verifyMetaSignature } from "./whatsappProvider.js";
import { parseMetaWebhook } from "./whatsappWebhook.js";
import {
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

const server = http.createServer(async (req, res) => {
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

    if (req.method === "GET" && url.pathname === "/api/whatsapp/status") {
      return json(res, 200, whatsappStatus());
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      return json(res, 200, await all("SELECT id, name, email, role FROM users WHERE active ORDER BY id"));
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJson(req);
      const user = await get(
        "SELECT id, name, email, role FROM users WHERE email = :email AND password = :password AND active",
        { email: body.email, password: body.password }
      );
      if (!user) return json(res, 401, { error: "Invalid login" });
      return json(res, 200, { user });
    }

    if (req.method === "GET" && url.pathname === "/api/meta") {
      return json(res, 200, { statuses: STATUSES, rejectionReasons: REJECTION_REASONS });
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      return json(res, 200, await dashboardCounts());
    }

    if (req.method === "GET" && url.pathname === "/api/leads") {
      return json(res, 200, await listLeads(Object.fromEntries(url.searchParams.entries())));
    }

    const leadMatch = url.pathname.match(/^\/api\/leads\/(\d+)$/);
    if (req.method === "GET" && leadMatch) {
      const id = Number(leadMatch[1]);
      const lead = await leadById(id);
      if (!lead) return json(res, 404, { error: "Lead not found" });
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
      const messages = await whatsappMessagesForLead(id);
      const replyWindow = await whatsAppReplyWindowForLead(id);
      return json(res, 200, { messages, replyWindow });
    }

    const leadWhatsAppTextMatch = url.pathname.match(/^\/api\/leads\/(\d+)\/whatsapp\/messages$/);
    if (req.method === "POST" && leadWhatsAppTextMatch) {
      const id = Number(leadWhatsAppTextMatch[1]);
      const body = await readJson(req);
      const result = await sendLeadWhatsAppText({
        leadId: id,
        userId: currentUserId(req, body),
        body: body.text || body.body || ""
      });
      return json(res, 200, result);
    }

    const leadWhatsAppSendMatch = url.pathname.match(/^\/api\/leads\/(\d+)\/whatsapp\/send$/);
    if (req.method === "POST" && leadWhatsAppSendMatch) {
      const id = Number(leadWhatsAppSendMatch[1]);
      const body = await readJson(req);
      const result = await sendLeadWhatsAppTemplate({
        leadId: id,
        userId: currentUserId(req, body),
        templateName: body.templateName,
        language: body.language || "en",
        parameters: Array.isArray(body.parameters) ? body.parameters : []
      });
      return json(res, 200, result);
    }

    if (req.method === "POST" && leadMatch) {
      const id = Number(leadMatch[1]);
      const body = await readJson(req);
      const userId = currentUserId(req, body);
      return json(res, 200, await updateLead(id, body, userId));
    }

    if (req.method === "POST" && url.pathname === "/api/sync") {
      const body = await readJson(req);
      const result = await syncGoogleSheet(currentUserId(req, body));
      return json(res, 200, result);
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`CRM API running on http://localhost:${PORT}`);
});

async function dashboardCounts() {
  const today = dateOnly();
  const params = { today, cutoff: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() };
  return {
    newLeads: await scalar("SELECT COUNT(*) FROM leads WHERE status = 'New'"),
    attemptedLeads: await scalar("SELECT COUNT(*) FROM leads WHERE status = 'Attempted'"),
    missedLeads: await scalar(
      `SELECT COUNT(*) FROM leads
       WHERE status IN ('New', 'Attempted')
       AND last_activity_at < :cutoff
       AND followup_date IS NULL
       AND site_visit_date IS NULL`,
      params
    ),
    todaysFollowups: await scalar("SELECT COUNT(*) FROM leads WHERE status = 'Follow Up' AND followup_date = :today", params),
    missedFollowups: await scalar("SELECT COUNT(*) FROM leads WHERE status = 'Follow Up' AND followup_date < :today", params),
    todaysSiteVisits: await scalar("SELECT COUNT(*) FROM leads WHERE status = 'Site Visit' AND site_visit_date = :today", params),
    missedSiteVisits: await scalar(
      `SELECT COUNT(*) FROM leads
       WHERE status = 'Site Visit'
       AND site_visit_date < :today
       AND site_visit_completed_at IS NULL`,
      params
    ),
    superInterested: await scalar("SELECT COUNT(*) FROM leads WHERE status = 'Super Interested'")
  };
}

async function listLeads(query) {
  const clauses = [];
  const params = {
    today: dateOnly(),
    tomorrow: tomorrowDate(),
    yesterday: yesterdayDate(),
    sevenDaysAgo: sevenDaysAgo(),
    monthStart: monthStart(),
    cutoff: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  };

  if (query.view === "my" && query.userId) {
    clauses.push("l.assigned_to = :userId");
    params.userId = Number(query.userId);
  }
  if (query.status) {
    clauses.push("l.status = :status");
    params.status = query.status;
  }
  if (query.assignedTo) {
    clauses.push("l.assigned_to = :assignedTo");
    params.assignedTo = Number(query.assignedTo);
  }
  if (query.search) {
    clauses.push("(LOWER(l.name) LIKE :search OR l.phone LIKE :search)");
    params.search = `%${query.search.toLowerCase()}%`;
  }

  applyView(query, clauses, params);
  applyDatePreset(query, clauses, params);

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return all(
    `SELECT l.*, u.name AS assigned_name
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

async function updateLead(id, body, userId) {
  const lead = await leadById(id);
  if (!lead) throw new Error("Lead not found");

  if (body.action === "assignToMe") {
    await run("UPDATE leads SET assigned_to = :userId WHERE id = :id", { id, userId });
    await addActivity({ leadId: id, userId, activityType: "Assigned", oldValue: lead.assigned_name, newValue: String(userId), comment: "Assigned to me" });
    return leadById(id);
  }

  if (body.action === "comment") {
    await addActivity({ leadId: id, userId, activityType: "Comment Added", comment: body.comment || "" });
    return leadById(id);
  }

  if (body.action === "siteVisited") {
    await run("UPDATE leads SET site_visit_completed_at = :now WHERE id = :id", { id, now: isoNow() });
    await addActivity({ leadId: id, userId, activityType: "Site Visit Completed", comment: body.comment || "Site visit marked complete" });
    return leadById(id);
  }

  if (body.action === "status") {
    if (!STATUSES.includes(body.status)) throw new Error("Invalid status");
    const updates = {
      id,
      status: body.status,
      assignedTo: body.assignedTo || lead.assigned_to,
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
           assigned_to = COALESCE(:assignedTo, assigned_to),
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
      userId,
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

async function scalar(sql, params = {}) {
  const row = await get(sql, params);
  return Number(row.count ?? row["COUNT(*)"] ?? 0);
}

function currentUserId(req, body = {}) {
  return Number(req.headers["x-user-id"] || body.userId || 1);
}

async function readJson(req) {
  const raw = await readRaw(req);
  return raw.length ? JSON.parse(raw.toString("utf8")) : {};
}

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  const limit = 1024 * 1024;
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

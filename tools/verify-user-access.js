import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `nandd-mahal-user-access-${Date.now()}.sqlite`);
process.env.DATABASE_URL = "";
process.env.DATABASE_PATH = dbPath;
process.env.INITIAL_ADMIN_NAME = "QA Admin";
process.env.INITIAL_ADMIN_EMAIL = "admin@example.com";
process.env.INITIAL_ADMIN_PASSWORD = "AdminPass123!";
process.env.COOKIE_SECURE = "false";
process.env.PORT = String(4700 + Math.floor(Math.random() * 100));

const assertions = [];
let server;
let db;
let run;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  assertions.push(message);
}

async function call(pathname, options = {}, cookie = "") {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT}${pathname}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json();
  const setCookie = response.headers.get("set-cookie") || "";
  return {
    status: response.status,
    payload,
    cookie: setCookie.split(";")[0]
  };
}

try {
  ({ db, run } = await import("../server/db.js"));
  ({ server } = await import("../server/server.js"));

  const adminLogin = await call("/api/auth/login", {
    method: "POST",
    body: { identifier: "admin@example.com", password: "AdminPass123!" }
  });
  assert(adminLogin.status === 200 && adminLogin.cookie.startsWith("crm_session="), "admin login creates an HTTP-only session cookie");

  const createUser = await call("/api/users", {
    method: "POST",
    body: { name: "QA Sales", email: "sales@example.com", password: "SalesPass123!", role: "sales" }
  }, adminLogin.cookie);
  assert(createUser.status === 201, "admin can create a sales user");
  const salesUserId = createUser.payload.user.id;

  await run(
    `INSERT INTO leads (meta_lead_id, created_at, meta_created_at, name, phone, status, last_activity_at, assigned_to)
     VALUES (:metaLeadId, :createdAt, :metaCreatedAt, :name, :phone, :status, :lastActivityAt, :assignedTo)`,
    {
      metaLeadId: "qa-assigned-lead",
      createdAt: new Date().toISOString(),
      metaCreatedAt: new Date().toISOString(),
      name: "Assigned QA Lead",
      phone: "+911234567890",
      status: "New",
      lastActivityAt: new Date().toISOString(),
      assignedTo: salesUserId
    }
  );
  await run(
    `INSERT INTO leads (meta_lead_id, created_at, meta_created_at, name, phone, status, last_activity_at)
     VALUES (:metaLeadId, :createdAt, :metaCreatedAt, :name, :phone, :status, :lastActivityAt)`,
    {
      metaLeadId: "qa-admin-lead",
      createdAt: new Date().toISOString(),
      metaCreatedAt: new Date().toISOString(),
      name: "Admin QA Lead",
      phone: "+919876543210",
      status: "New",
      lastActivityAt: new Date().toISOString()
    }
  );

  const salesLogin = await call("/api/auth/login", {
    method: "POST",
    body: { identifier: "sales@example.com", password: "SalesPass123!" }
  });
  assert(salesLogin.status === 200, "sales user can log in with the created credentials");

  for (const pathname of [
    "/api/dashboard",
    "/api/meta",
    "/api/leads?list=new",
    "/api/leads?list=attempted",
    "/api/leads?list=followups",
    "/api/leads?list=sitevisits",
    "/api/leads?list=super",
    "/api/leads?list=rejected",
    "/api/leads?list=missed-leads",
    "/api/leads?list=missed-followups",
    "/api/leads?list=missed-sitevisits",
    "/api/leads?search=qa"
  ]) {
    const pageCheck = await call(pathname, {}, adminLogin.cookie);
    assert(pageCheck.status === 200, `admin page data endpoint responds: ${pathname}`);
  }

  const salesLeads = await call("/api/leads", {}, salesLogin.cookie);
  assert(salesLeads.status === 200 && salesLeads.payload.length === 1 && salesLeads.payload[0].name === "Assigned QA Lead", "sales user sees only assigned leads");

  const adminLeads = await call("/api/leads", {}, adminLogin.cookie);
  assert(adminLeads.status === 200 && adminLeads.payload.length === 2, "admin sees all leads");

  const forbiddenDetail = await call("/api/leads/2", {}, salesLogin.cookie);
  assert(forbiddenDetail.status === 403, "sales user cannot open an unassigned lead by URL");

  const forbiddenUsers = await call("/api/users", {}, salesLogin.cookie);
  assert(forbiddenUsers.status === 403, "sales user cannot access user management APIs");

  const assignment = await call("/api/leads/2", {
    method: "POST",
    body: { action: "assign", assignedTo: salesUserId }
  }, adminLogin.cookie);
  assert(assignment.status === 200 && assignment.payload.assigned_to === salesUserId, "admin can assign a lead to a sales user");

  const expandedSalesLeads = await call("/api/leads", {}, salesLogin.cookie);
  assert(expandedSalesLeads.status === 200 && expandedSalesLeads.payload.length === 2, "sales lead list reflects admin assignment");

  const deactivate = await call(`/api/users/${salesUserId}`, {
    method: "PATCH",
    body: { active: false }
  }, adminLogin.cookie);
  assert(deactivate.status === 200 && deactivate.payload.user.active === false, "admin can deactivate a sales user");

  const deactivatedSession = await call("/api/auth/me", {}, salesLogin.cookie);
  assert(deactivatedSession.status === 401, "deactivation invalidates the user's active session");

  const logout = await call("/api/auth/logout", { method: "POST" }, adminLogin.cookie);
  assert(logout.status === 200, "admin can log out and clear the session");

  const unauthenticated = await call("/api/leads");
  assert(unauthenticated.status === 401, "lead APIs reject unauthenticated requests");

  console.log(`User access QA passed: ${assertions.length} checks.`);
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  db?.close();
  await fs.rm(dbPath, { force: true });
}

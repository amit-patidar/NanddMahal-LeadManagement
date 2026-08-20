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

  const createManager = await call("/api/users", {
    method: "POST",
    body: { name: "QA Manager", email: "manager@example.com", password: "ManagerPass123!", role: "manager" }
  }, adminLogin.cookie);
  assert(createManager.status === 201 && createManager.payload.user.role === "manager", "admin can create a manager user");

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
    `INSERT INTO leads (meta_lead_id, created_at, meta_created_at, name, phone, status, last_activity_at, assigned_to)
     VALUES (:metaLeadId, :createdAt, :metaCreatedAt, :name, :phone, :status, :lastActivityAt, :assignedTo)`,
    {
      metaLeadId: "qa-admin-lead",
      createdAt: new Date().toISOString(),
      metaCreatedAt: new Date().toISOString(),
      name: "Admin QA Lead",
      phone: "+919876543210",
      status: "New",
      lastActivityAt: new Date().toISOString(),
      assignedTo: 1
    }
  );
  await run(
    `INSERT INTO leads (meta_lead_id, created_at, meta_created_at, name, phone, status, last_activity_at)
     VALUES (:metaLeadId, :createdAt, :metaCreatedAt, :name, :phone, :status, :lastActivityAt)`,
    {
      metaLeadId: "qa-unassigned-lead",
      createdAt: new Date().toISOString(),
      metaCreatedAt: new Date().toISOString(),
      name: "Unassigned QA Lead",
      phone: "+919111111111",
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
  assert(salesLeads.status === 200 && salesLeads.payload.length === 1 && salesLeads.payload[0].name === "Assigned QA Lead", "sales All Leads view stays assigned-only");

  const salesNewQueue = await call("/api/leads?list=new", {}, salesLogin.cookie);
  assert(salesNewQueue.status === 200 && salesNewQueue.payload.length === 1, "sales New Leads view stays assigned-only");

  const adminLeads = await call("/api/leads", {}, adminLogin.cookie);
  assert(adminLeads.status === 200 && adminLeads.payload.length === 3, "admin sees all leads");

  const forbiddenDetail = await call("/api/leads/2", {}, salesLogin.cookie);
  assert(forbiddenDetail.status === 403, "sales user cannot open another user's lead by URL");

  const unassignedDetail = await call("/api/leads/3", {}, salesLogin.cookie);
  assert(unassignedDetail.status === 403, "sales user cannot open an unassigned lead by URL");

  const forbiddenUsers = await call("/api/users", {}, salesLogin.cookie);
  assert(forbiddenUsers.status === 403, "sales user cannot access user management APIs");

  const forbiddenSelfAssign = await call("/api/leads/1", {
    method: "POST",
    body: { action: "assignToMe" }
  }, salesLogin.cookie);
  assert(forbiddenSelfAssign.status === 403, "sales user cannot assign an already assigned lead to themselves");

  const managerLogin = await call("/api/auth/login", {
    method: "POST",
    body: { identifier: "manager@example.com", password: "ManagerPass123!" }
  });
  assert(managerLogin.status === 200, "manager user can log in with the created credentials");

  const managerLeads = await call("/api/leads", {}, managerLogin.cookie);
  assert(managerLeads.status === 200 && managerLeads.payload.length === 3, "manager sees all leads");

  const managerUsers = await call("/api/users", {}, managerLogin.cookie);
  assert(managerUsers.status === 200 && managerUsers.payload.length === 3, "manager can load the assignment user list");

  const managerCannotCreateUser = await call("/api/users", {
    method: "POST",
    body: { name: "Not Allowed", email: "not-allowed@example.com", password: "BlockedPass123!", role: "sales" }
  }, managerLogin.cookie);
  assert(managerCannotCreateUser.status === 403, "manager cannot manage user accounts");

  const claim = await call("/api/leads/3", {
    method: "POST",
    body: { action: "assign", assignedTo: salesUserId }
  }, salesLogin.cookie);
  assert(claim.status === 403, "sales user cannot assign a lead");

  const managerAssignment = await call("/api/leads/3", {
    method: "POST",
    body: { action: "assign", assignedTo: salesUserId }
  }, managerLogin.cookie);
  assert(managerAssignment.status === 200 && managerAssignment.payload.assigned_to === salesUserId, "manager can assign an unassigned lead to a sales user");

  const adminAssignment = await call("/api/leads/2", {
    method: "POST",
    body: { action: "assign", assignedTo: salesUserId }
  }, adminLogin.cookie);
  assert(adminAssignment.status === 200 && adminAssignment.payload.assigned_to === salesUserId, "admin can assign a lead to a sales user");

  const expandedSalesLeads = await call("/api/leads", {}, salesLogin.cookie);
  assert(expandedSalesLeads.status === 200 && expandedSalesLeads.payload.length === 3, "sales All Leads view reflects manager and admin assignments");

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

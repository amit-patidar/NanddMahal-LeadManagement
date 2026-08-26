import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `nandd-mahal-manual-leads-${Date.now()}.sqlite`);
process.env.DATABASE_URL = "";
process.env.DATABASE_PATH = dbPath;
process.env.INITIAL_ADMIN_NAME = "Manual Lead QA Admin";
process.env.INITIAL_ADMIN_EMAIL = "manual-lead-admin@example.com";
process.env.INITIAL_ADMIN_PASSWORD = "ManualLeadAdmin123!";
process.env.COOKIE_SECURE = "false";
process.env.PORT = String(48000 + Math.floor(Math.random() * 1000));

const assertions = [];
let server;
let db;

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
  return {
    status: response.status,
    payload,
    cookie: (response.headers.get("set-cookie") || "").split(";")[0]
  };
}

async function login(identifier, password) {
  return call("/api/auth/login", { method: "POST", body: { identifier, password } });
}

async function createUser(cookie, user) {
  return call("/api/users", { method: "POST", body: user }, cookie);
}

try {
  const dbModule = await import("../server/db.js");
  db = dbModule.db;
  await dbModule.initDb();
  server = (await import("../server/server.js")).server;

  const adminLogin = await login("manual-lead-admin@example.com", "ManualLeadAdmin123!");
  assert(adminLogin.status === 200, "admin can log in");

  const managerResult = await createUser(adminLogin.cookie, {
    name: "QA Manager",
    email: "manual-lead-manager@example.com",
    password: "ManagerPass123!",
    role: "manager"
  });
  const salesResult = await createUser(adminLogin.cookie, {
    name: "QA Sales",
    email: "manual-lead-sales@example.com",
    password: "SalesPass123!",
    role: "sales"
  });
  const secondSalesResult = await createUser(adminLogin.cookie, {
    name: "QA Sales Two",
    email: "manual-lead-sales-two@example.com",
    password: "SalesTwoPass123!",
    role: "sales"
  });
  const inactiveResult = await createUser(adminLogin.cookie, {
    name: "Inactive Sales",
    email: "manual-lead-inactive@example.com",
    password: "InactivePass123!",
    role: "sales",
    active: false
  });
  assert([managerResult, salesResult, secondSalesResult, inactiveResult].every((result) => result.status === 201), "admin can create QA users");

  const managerId = managerResult.payload.user.id;
  const salesId = salesResult.payload.user.id;
  const secondSalesId = secondSalesResult.payload.user.id;
  const inactiveId = inactiveResult.payload.user.id;
  const managerLogin = await login("manual-lead-manager@example.com", "ManagerPass123!");
  const salesLogin = await login("manual-lead-sales@example.com", "SalesPass123!");
  const secondSalesLogin = await login("manual-lead-sales-two@example.com", "SalesTwoPass123!");
  assert(managerLogin.status === 200 && salesLogin.status === 200 && secondSalesLogin.status === 200, "manager and sales users can log in");

  const adminCreated = await call("/api/leads", {
    method: "POST",
    body: {
      name: "Side Lead One",
      phone: "98765 01111",
      email: "SIDE.LEAD@example.com",
      lookingFor: "80 lakh",
      buyPlan: "Within 3 months",
      comment: "Referral from existing customer",
      assignedTo: salesId
    }
  }, adminLogin.cookie);
  assert(adminCreated.status === 201, "admin can create a manual lead");
  const firstLead = adminCreated.payload.lead;
  assert(firstLead.status === "New" && firstLead.assigned_to === salesId, "admin-created lead is New and assigned to the selected user");
  assert(firstLead.phone === "+919876501111" && firstLead.email === "side.lead@example.com", "phone and email are normalized");
  assert(firstLead.looking_for === "80 lakh" && firstLead.buy_plan === "Within 3 months", "budget and Buy Plan are stored");
  assert(firstLead.last_comment === "Referral from existing customer", "initial comment becomes the last comment");
  assert(firstLead.campaign === "Manual Entry" && firstLead.meta_lead_id.startsWith("manual:"), "manual origin and internal ID are stored");

  const detail = await call(`/api/leads/${firstLead.id}`, {}, adminLogin.cookie);
  assert(detail.status === 200, "created lead detail can be opened");
  assert(detail.payload.activities.some((activity) => activity.activity_type === "Lead Created" && activity.comment === "Added manually"), "creation activity records manual origin");
  assert(detail.payload.activities.some((activity) => activity.activity_type === "Comment Added" && activity.comment === "Referral from existing customer"), "initial comment has its own activity");

  const duplicate = await call("/api/leads", {
    method: "POST",
    body: { name: "Duplicate Side Lead", phone: "09876501111", assignedTo: managerId }
  }, managerLogin.cookie);
  assert(duplicate.status === 409 && duplicate.payload.existingLeadId === firstLead.id, "formatted duplicate phone is blocked and visible to a manager");

  const salesCreated = await call("/api/leads", {
    method: "POST",
    body: { name: "Sales Side Lead", phone: "9876502222", assignedTo: managerId }
  }, salesLogin.cookie);
  assert(salesCreated.status === 201, "sales user can create a manual lead");
  assert(salesCreated.payload.lead.assigned_to === salesId, "sales assignment spoofing is ignored and the lead is self-assigned");

  const hiddenDuplicate = await call("/api/leads", {
    method: "POST",
    body: { name: "Hidden Duplicate", phone: "+91 98765 02222", assignedTo: secondSalesId }
  }, secondSalesLogin.cookie);
  assert(hiddenDuplicate.status === 409 && !Object.hasOwn(hiddenDuplicate.payload, "existingLeadId"), "duplicate assigned to another sales user does not expose the lead ID");

  const managerCreated = await call("/api/leads", {
    method: "POST",
    body: { name: "Unassigned Side Lead", phone: "9876503333", assignedTo: null }
  }, managerLogin.cookie);
  assert(managerCreated.status === 201 && managerCreated.payload.lead.assigned_to === null, "manager can create an unassigned lead");

  const inactiveAssignment = await call("/api/leads", {
    method: "POST",
    body: { name: "Inactive Assignment", phone: "9876504444", assignedTo: inactiveId }
  }, adminLogin.cookie);
  assert(inactiveAssignment.status === 400, "inactive assignee is rejected");

  const missingName = await call("/api/leads", { method: "POST", body: { phone: "9876505555" } }, adminLogin.cookie);
  const badPhone = await call("/api/leads", { method: "POST", body: { name: "Bad Phone", phone: "123" } }, adminLogin.cookie);
  const badEmail = await call("/api/leads", { method: "POST", body: { name: "Bad Email", phone: "9876506666", email: "not-an-email" } }, adminLogin.cookie);
  const longName = await call("/api/leads", { method: "POST", body: { name: "x".repeat(121), phone: "9876507777" } }, adminLogin.cookie);
  assert([missingName, badPhone, badEmail, longName].every((result) => result.status === 400), "required fields and field validation are enforced");

  const unauthenticated = await call("/api/leads", { method: "POST", body: { name: "No Session", phone: "9876508888" } });
  assert(unauthenticated.status === 401, "manual lead creation requires authentication");

  const salesLeads = await call("/api/leads", {}, salesLogin.cookie);
  assert(salesLeads.status === 200 && salesLeads.payload.length === 2, "sales user sees only manual leads assigned to that account");
  const searchedLead = await call("/api/leads?search=Side%20Lead%20One", {}, adminLogin.cookie);
  assert(searchedLead.status === 200 && searchedLead.payload.some((lead) => lead.id === firstLead.id), "manual lead is immediately searchable");
  const whatsappAccess = await call(`/api/leads/${firstLead.id}/whatsapp/messages`, {}, salesLogin.cookie);
  assert(whatsappAccess.status === 200 && Array.isArray(whatsappAccess.payload.messages), "assigned sales user can open the manual lead WhatsApp workflow");
  const dashboard = await call("/api/dashboard", {}, adminLogin.cookie);
  assert(dashboard.status === 200 && dashboard.payload.newLeads === 3, "manual leads are included in New Leads dashboard count");

  const manualBeforeSheetImport = await dbModule.get("SELECT * FROM leads WHERE id = :id", { id: firstLead.id });
  await dbModule.createLeadFromSource({
    meta_lead_id: "sheet-import-qa",
    name: "Sheet Import QA",
    phone: "9876509999",
    looking_for: "Sheet budget",
    buy_plan: "Sheet timeline",
    imported_from: "Google Sheet"
  }, adminLogin.payload.user.id);
  const manualAfterSheetImport = await dbModule.get("SELECT * FROM leads WHERE id = :id", { id: firstLead.id });
  assert(
    manualAfterSheetImport.meta_lead_id === manualBeforeSheetImport.meta_lead_id &&
      manualAfterSheetImport.looking_for === manualBeforeSheetImport.looking_for &&
      manualAfterSheetImport.buy_plan === manualBeforeSheetImport.buy_plan &&
      manualAfterSheetImport.last_comment === manualBeforeSheetImport.last_comment,
    "sheet-source import leaves the manual lead unchanged"
  );

  console.log(`Manual lead QA passed: ${assertions.length} checks.`);
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  db?.close();
  await fs.rm(dbPath, { force: true });
}

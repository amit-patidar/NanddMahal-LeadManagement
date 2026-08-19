import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const databasePath = path.join(os.tmpdir(), `lead-comment-search-${Date.now()}.sqlite`);
const port = 47000 + Math.floor(Math.random() * 1000);
process.env.DATABASE_URL = "";
process.env.DATABASE_PATH = databasePath;
process.env.PORT = String(port);

let exitCode = 0;
let testServer;
let testDb;

try {
  const { addActivity, db, get, initDb, run } = await import("../server/db.js");
  testDb = db;
  await initDb();

  const now = new Date().toISOString();
  await run(
    `INSERT INTO leads
      (meta_lead_id, created_at, meta_created_at, name, phone, status, last_activity_at, last_comment)
     VALUES (:metaLeadId, :createdAt, :metaCreatedAt, :name, :phone, 'New', :lastActivityAt, :lastComment)`,
    {
      metaLeadId: "test-comment-search",
      createdAt: now,
      metaCreatedAt: now,
      name: "Comment Search Test",
      phone: "9999999999",
      lastActivityAt: now,
      lastComment: "Latest note without the budget"
    }
  );

  const lead = await get("SELECT id FROM leads WHERE meta_lead_id = :metaLeadId", { metaLeadId: "test-comment-search" });
  await addActivity({ leadId: lead.id, activityType: "Comment Added", comment: "Buyer is interested in 8k budget" });
  await addActivity({ leadId: lead.id, activityType: "Comment Added", comment: "Latest note without the budget" });

  const serverModule = await import("../server/server.js");
  testServer = serverModule.server;
  const response = await fetch(`http://localhost:${port}/api/leads?search=8k`);
  const results = await response.json();

  if (!response.ok || results.length !== 1 || !results[0].matched_comment?.includes("8k budget")) {
    throw new Error(`Comment search assertion failed: ${JSON.stringify(results)}`);
  }

  console.log("COMMENT_SEARCH_ASSERTION=PASS");
} catch (error) {
  exitCode = 1;
  console.error(error.message);
} finally {
  if (testServer?.listening) {
    await new Promise((resolve) => testServer.close(resolve));
  }
  if (testDb && typeof testDb.close === "function") {
    testDb.close();
  }
  await fs.rm(databasePath, { force: true });
}

process.exit(exitCode);

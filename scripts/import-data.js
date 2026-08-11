import fs from "node:fs/promises";
import { db, initDb } from "../server/db.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. This import is intended for PostgreSQL.");
}

const inputPath = process.env.EXPORT_PATH || "./crm-export.json";
const data = JSON.parse(await fs.readFile(inputPath, "utf8"));

await initDb();

const client = await db.connect();
try {
  await client.query("BEGIN");
  await client.query("TRUNCATE lead_activities, leads, users RESTART IDENTITY CASCADE");

  for (const user of data.users) {
    await client.query(
      `INSERT INTO users (id, name, email, password, role, active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, user.name, user.email, user.password, user.role, Boolean(user.active), user.created_at]
    );
  }

  for (const lead of data.leads) {
    await client.query(
      `INSERT INTO leads
        (id, meta_lead_id, created_at, meta_created_at, name, phone, email, campaign, looking_for, buy_plan,
         status, assigned_to, followup_date, followup_time, site_visit_date, site_visit_time,
         site_visit_completed_at, last_activity_at, last_comment, rejection_reason, closed_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20, $21)`,
      [
        lead.id,
        lead.meta_lead_id,
        lead.created_at,
        lead.meta_created_at,
        lead.name,
        lead.phone,
        lead.email,
        lead.campaign,
        lead.looking_for,
        lead.buy_plan,
        lead.status,
        lead.assigned_to,
        lead.followup_date,
        lead.followup_time,
        lead.site_visit_date,
        lead.site_visit_time,
        lead.site_visit_completed_at,
        lead.last_activity_at,
        lead.last_comment,
        lead.rejection_reason,
        lead.closed_at
      ]
    );
  }

  for (const activity of data.lead_activities) {
    await client.query(
      `INSERT INTO lead_activities
        (id, lead_id, user_id, activity_type, old_value, new_value, comment, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        activity.id,
        activity.lead_id,
        activity.user_id,
        activity.activity_type,
        activity.old_value,
        activity.new_value,
        activity.comment,
        activity.created_at
      ]
    );
  }

  await client.query("SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)");
  await client.query("SELECT setval('leads_id_seq', COALESCE((SELECT MAX(id) FROM leads), 1), true)");
  await client.query("SELECT setval('lead_activities_id_seq', COALESCE((SELECT MAX(id) FROM lead_activities), 1), true)");
  await client.query("COMMIT");

  console.log(`Imported ${data.users.length} users, ${data.leads.length} leads, ${data.lead_activities.length} activities into PostgreSQL`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await db.end();
}

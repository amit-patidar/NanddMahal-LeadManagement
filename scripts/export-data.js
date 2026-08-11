import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";

const dbPath = process.env.DATABASE_PATH || "./crm.sqlite";
const outputPath = process.env.EXPORT_PATH || "./crm-export.json";
const db = new DatabaseSync(dbPath);

const data = {
  exportedAt: new Date().toISOString(),
  users: db.prepare("SELECT * FROM users ORDER BY id").all(),
  leads: db.prepare("SELECT * FROM leads ORDER BY id").all(),
  lead_activities: db.prepare("SELECT * FROM lead_activities ORDER BY id").all()
};

await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
console.log(`Exported ${data.users.length} users, ${data.leads.length} leads, ${data.lead_activities.length} activities to ${outputPath}`);

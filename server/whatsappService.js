import {
  addActivity,
  findLeadByPhone,
  get,
  normalizePhone,
  recordWhatsAppEvent,
  recordWhatsAppMessage,
  whatsappMessagesForLead
} from "./db.js";
import { sendMetaTemplateMessage, whatsappStatus } from "./whatsappProvider.js";

export { whatsappMessagesForLead, whatsappStatus };

export async function processWhatsAppEvents(events) {
  const results = [];
  for (const event of events) {
    results.push(await processWhatsAppEvent(event));
  }
  return results;
}

export async function sendLeadWhatsAppTemplate({ leadId, userId, templateName, language = "en", parameters = [] }) {
  const lead = await get("SELECT * FROM leads WHERE id = :leadId", { leadId });
  if (!lead) throw new Error("Lead not found");

  const to = normalizePhone(lead.phone);
  if (!to) throw new Error("Lead phone number is missing or invalid.");

  const providerPayload = await sendMetaTemplateMessage({ to, templateName, language, parameters });
  const providerMessageId = providerPayload.messages?.[0]?.id || null;
  const now = new Date().toISOString();

  await recordWhatsAppMessage({
    leadId,
    provider: "meta",
    providerMessageId,
    direction: "outbound",
    messageType: "template",
    templateName,
    phone: to,
    status: "sent",
    sentByUserId: userId,
    rawPayload: providerPayload,
    createdAt: now,
    sentAt: now
  });
  await addActivity({
    leadId,
    userId,
    activityType: "WhatsApp Sent",
    newValue: templateName,
    comment: `Template sent: ${templateName}`
  });

  return { sent: true, providerMessageId };
}

async function processWhatsAppEvent(event) {
  const lead = await findLeadByPhone(event.phone);
  const leadId = lead?.id || null;
  const status = event.status || (event.direction === "inbound" ? "received" : "sent");
  const timestamp = event.timestamp || new Date().toISOString();

  const eventResult = await recordWhatsAppEvent({
    provider: "meta",
    eventKey: event.eventKey,
    providerMessageId: event.providerMessageId,
    leadId,
    eventType: event.eventType,
    rawPayload: event.rawPayload,
    receivedAt: new Date().toISOString(),
    processedAt: new Date().toISOString(),
    processingStatus: leadId ? "processed" : "unmatched"
  });

  await recordWhatsAppMessage({
    leadId,
    provider: "meta",
    providerMessageId: event.providerMessageId,
    direction: event.direction,
    messageType: event.messageType || "unknown",
    body: event.body || null,
    phone: event.phone ? normalizePhone(event.phone) : null,
    status,
    errorCode: event.errorCode,
    errorMessage: event.errorMessage,
    rawPayload: event.rawPayload,
    createdAt: timestamp,
    sentAt: ["sent"].includes(status) ? timestamp : null,
    deliveredAt: status === "delivered" ? timestamp : null,
    readAt: status === "read" ? timestamp : null,
    failedAt: status === "failed" ? timestamp : null
  });

  if (leadId && eventResult.changes > 0) {
    await addActivity({
      leadId,
      userId: null,
      activityType: activityTypeFor(event),
      newValue: event.status || null,
      comment: activityCommentFor(event)
    });
  }

  return { eventKey: event.eventKey, leadId, status, duplicate: eventResult.changes === 0 };
}

function activityTypeFor(event) {
  if (event.direction === "inbound") return "WhatsApp Reply Received";
  if (event.status === "delivered") return "WhatsApp Delivered";
  if (event.status === "read") return "WhatsApp Read";
  if (event.status === "failed") return "WhatsApp Failed";
  return "WhatsApp Status Updated";
}

function activityCommentFor(event) {
  if (event.direction === "inbound") return event.body || "Incoming WhatsApp message";
  if (event.errorMessage) return event.errorMessage;
  return event.status ? `WhatsApp message ${event.status}` : "WhatsApp event received";
}

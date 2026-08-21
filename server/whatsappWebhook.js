export function parseMetaWebhook(payload) {
  const events = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || "";

      for (const message of value.messages || []) {
        events.push({
          eventKey: `meta:message:${message.id}`,
          eventType: "message_received",
          providerMessageId: message.id,
          phone: message.from,
          direction: "inbound",
          messageType: message.type || "unknown",
          body: message.text?.body || message.button?.text || message.interactive?.button_reply?.title || "",
          timestamp: metaTimestamp(message.timestamp),
          phoneNumberId,
          rawPayload: { entry, change, message }
        });
      }

      for (const status of value.statuses || []) {
        events.push({
          eventKey: `meta:status:${status.id}:${status.status}`,
          eventType: `message_${status.status}`,
          providerMessageId: status.id,
          phone: status.recipient_id,
          direction: "outbound",
          messageType: "status",
          status: status.status,
          timestamp: metaTimestamp(status.timestamp),
          errorCode: status.errors?.[0]?.code ? String(status.errors[0].code) : null,
          errorMessage: status.errors?.[0]?.title || status.errors?.[0]?.message || null,
          phoneNumberId,
          rawPayload: { entry, change, status }
        });
      }
    }
  }
  return events;
}

function metaTimestamp(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

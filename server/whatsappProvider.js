import crypto from "node:crypto";

export function whatsappConfig() {
  return {
    provider: process.env.WHATSAPP_PROVIDER || "meta",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
    appSecret: process.env.WHATSAPP_APP_SECRET || "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    apiVersion: process.env.WHATSAPP_API_VERSION || "v23.0",
    requireSignature: process.env.WHATSAPP_WEBHOOK_REQUIRE_SIGNATURE !== "false"
  };
}

export function whatsappStatus() {
  const config = whatsappConfig();
  return {
    provider: config.provider,
    callbackUrlPath: "/api/webhooks/whatsapp/meta",
    configured: Boolean(config.verifyToken && config.accessToken && config.phoneNumberId),
    webhookConfigured: Boolean(config.verifyToken),
    sendConfigured: Boolean(config.accessToken && config.phoneNumberId),
    signatureVerification: Boolean(config.appSecret && config.requireSignature)
  };
}

export function verifyMetaChallenge(query) {
  const config = whatsappConfig();
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");

  if (mode === "subscribe" && token && token === config.verifyToken && challenge) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

export function verifyMetaSignature(rawBody, signatureHeader) {
  const config = whatsappConfig();
  if (!config.requireSignature) return true;
  if (!config.appSecret || !signatureHeader?.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", config.appSecret)
    .update(rawBody)
    .digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  return timingSafeEqual(expected, received);
}

export async function sendMetaTemplateMessage({ to, templateName, language = "en", parameters = [] }) {
  const config = whatsappConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    throw new Error("WhatsApp sending is not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.");
  }
  if (!templateName) throw new Error("Template name is required.");

  const components = parameters.length
    ? [{
        type: "body",
        parameters: parameters.map((value) => ({ type: "text", text: String(value ?? "") }))
      }]
    : undefined;

  const response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${config.accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        ...(components ? { components } : {})
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `WhatsApp send failed with status ${response.status}`;
    const error = new Error(message);
    error.providerStatus = response.status;
    error.providerPayload = payload;
    throw error;
  }
  return payload;
}

export async function sendMetaTextMessage({ to, body }) {
  const config = whatsappConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    throw new Error("WhatsApp sending is not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.");
  }
  if (!body?.trim()) throw new Error("Message is required.");

  const response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${config.accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: body.trim()
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `WhatsApp send failed with status ${response.status}`;
    const error = new Error(message);
    error.providerStatus = response.status;
    error.providerPayload = payload;
    throw error;
  }
  return payload;
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

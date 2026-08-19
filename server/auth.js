import { randomBytes } from "node:crypto";
import { get, run } from "./db.js";
import { verifyPassword } from "./passwords.js";

const SESSION_COOKIE = "crm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export async function authenticateUser(identifier, password) {
  const normalizedIdentifier = String(identifier || "").trim().toLowerCase();
  if (!normalizedIdentifier || !password) return null;

  const user = await get(
    `SELECT id, name, email, role, active, password_hash, password_salt
     FROM users
     WHERE LOWER(email) = :identifier AND active`,
    { identifier: normalizedIdentifier }
  );

  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) return null;
  return publicUser(user);
}

export async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await run(
    `INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at)
     VALUES (:id, :userId, :expiresAt, :createdAt, :lastSeenAt)`,
    {
      id: token,
      userId,
      expiresAt,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString()
    }
  );
  return token;
}

export async function getSessionUser(req) {
  const token = parseCookies(req.headers.cookie || "").get(SESSION_COOKIE);
  if (!token) return null;

  const session = await get(
    `SELECT s.id AS session_id, u.id, u.name, u.email, u.role, u.active
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = :id AND s.expires_at > :now AND u.active`,
    { id: token, now: new Date().toISOString() }
  );

  if (!session) return null;
  await run("UPDATE sessions SET last_seen_at = :now WHERE id = :id", { id: token, now: new Date().toISOString() });
  return publicUser(session);
}

export async function destroySession(req) {
  const token = parseCookies(req.headers.cookie || "").get(SESSION_COOKIE);
  if (token) await run("DELETE FROM sessions WHERE id = :id", { id: token });
}

export function setSessionCookie(res, token) {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secureCookieSuffix()}`);
}

export function clearSessionCookie(res) {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookieSuffix()}`);
}

export function publicUser(user) {
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    active: Boolean(user.active)
  };
}

function parseCookies(header) {
  return new Map(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, ...value]) => [name, value.join("=")])
  );
}

function secureCookieSuffix() {
  return process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production" ? "; Secure" : "";
}

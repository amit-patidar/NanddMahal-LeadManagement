import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password, { enforceLength = true } = {}) {
  if (typeof password !== "string" || (enforceLength && password.length < 8)) {
    throw new Error("Password must be at least 8 characters.");
  }

  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, expectedHash, salt) {
  if (!password || !expectedHash || !salt) return false;

  const actual = scryptSync(String(password), salt, KEY_LENGTH);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

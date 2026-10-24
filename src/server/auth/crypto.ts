import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Recovery codes are random, so a peppered SHA-256 is enough to store them. */
const PEPPER = "proje-calisma-alani:recovery:v1";
export function hashSecret(value: string) {
  return sha256(`${PEPPER}:${value}`);
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Crockford-style alphabet without look-alike characters (no 0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "K7QM-2XRA-9DPV": 12 characters, about 59 bits of randomness. */
export function newRecoveryCode() {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

export function normalizeRecoveryCode(input: string) {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 12) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Six digits for pairing a new device, shown on the signed-in device. */
export function newPairingCode() {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200, "That is longer than any password needs to be");

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

// 12 characters with the shapes people misread removed: no 0/O, no l/1/I.
const SAFE_CHARS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A temporary password to hand to a new teammate. */
export function generatePassword(length = 12): string {
  // Rejection-sampled so the modulo does not favour the front of the alphabet.
  const limit = 256 - (256 % SAFE_CHARS.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      out += SAFE_CHARS[byte % SAFE_CHARS.length];
      if (out.length === length) break;
    }
  }
  return out;
}

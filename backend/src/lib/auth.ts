import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const _envSecret = process.env.JWT_SECRET;
if (!_envSecret) {
  throw new Error("FATAL: JWT_SECRET environment variable must be set");
}
const jwtSecret: string = _envSecret;

export type TokenPayload = {
  sub: string;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, jwtSecret, { expiresIn: "12h" });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, jwtSecret) as TokenPayload;
}

/** Generate a cryptographically-random opaque refresh token (returns raw token + SHA-256 hash to store). */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(40).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

/** Hash an incoming refresh token for DB lookup. */
export function hashRefreshToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Refresh token TTL: 30 days. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

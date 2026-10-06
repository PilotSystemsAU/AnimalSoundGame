import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE = "ag_admin";
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function adminPasswordIsSet(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

// The admin pass is derived from the password, so changing ADMIN_PASSWORD
// in Vercel signs out every device that was logged in before.
export function adminToken(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const secret = process.env.ADMIN_COOKIE_SECRET || "";
  return createHmac("sha256", password + "\u0000" + secret).update("animal-game-admin-v1").digest("hex");
}

export function checkPassword(attempt: unknown): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || typeof attempt !== "string") return false;
  return safeEqual(attempt, password);
}

export function isAdmin(req: NextRequest): boolean {
  const expected = adminToken();
  const got = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!expected || !got) return false;
  return safeEqual(got, expected);
}

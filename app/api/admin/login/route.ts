import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE, adminPasswordIsSet, adminToken, checkPassword } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!adminPasswordIsSet()) {
    return json(
      { error: "No admin password has been set yet. Add ADMIN_PASSWORD in the Vercel project settings, then redeploy." },
      503
    );
  }
  const body = await req.json().catch(() => ({}));
  if (!checkPassword((body as { password?: unknown }).password)) {
    return json({ error: "Wrong password." }, 401);
  }
  const res = json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminToken()!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return res;
}

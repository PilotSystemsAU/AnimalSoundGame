import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getConfig, getRoundState } from "@/lib/game";
import { handleError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return json({ error: "Not signed in." }, 401);
  try {
    const [config, round] = await Promise.all([getConfig(), getRoundState()]);
    return json({ config, round });
  } catch (err) {
    return handleError(err);
  }
}

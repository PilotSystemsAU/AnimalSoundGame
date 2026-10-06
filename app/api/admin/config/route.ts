import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { saveConfig, validateConfig } from "@/lib/game";
import { handleError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

// Saved settings take effect at the next New round, never mid-round.
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return json({ error: "Not signed in." }, 401);
  try {
    const body = await req.json().catch(() => null);
    const result = validateConfig(body);
    if (!result.ok) return json({ error: result.error }, 400);
    await saveConfig(result.config);
    return json({ config: result.config });
  } catch (err) {
    return handleError(err);
  }
}

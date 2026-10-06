import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { newRound } from "@/lib/game";
import { handleError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return json({ error: "Not signed in." }, 401);
  try {
    return json(await newRound());
  } catch (err) {
    return handleError(err);
  }
}

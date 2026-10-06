import type { NextRequest } from "next/server";
import { isValidDeviceId, join } from "@/lib/game";
import { handleError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const deviceId = (body as { deviceId?: unknown }).deviceId;
    if (!isValidDeviceId(deviceId)) return json({ error: "Invalid device ID." }, 400);
    return json(await join(deviceId));
  } catch (err) {
    return handleError(err);
  }
}

import { getCurrentRoundId } from "@/lib/game";
import { handleError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

// The player page checks this every 5 seconds to notice a new round.
export async function GET() {
  try {
    return json({ roundId: await getCurrentRoundId() });
  } catch (err) {
    return handleError(err);
  }
}

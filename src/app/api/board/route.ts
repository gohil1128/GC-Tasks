import { readJson } from "@/modules/tasks/http";
import { getBoard } from "@/modules/tasks/queries";

// The board (BoardData), as the person asking may see it. Fetched on load and whenever the polled revision moves.
export const dynamic = "force-dynamic";

export async function GET() {
  return readJson(getBoard);
}

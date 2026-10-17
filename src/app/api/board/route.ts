import { readJson } from "@/modules/tasks/http";
import { getBoard } from "@/modules/tasks/queries";

// The whole board (BoardData). Fetched on load and whenever the polled revision moves.
export const dynamic = "force-dynamic";

export async function GET() {
  return readJson(getBoard);
}

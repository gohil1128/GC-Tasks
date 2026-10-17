import { readJson } from "@/modules/tasks/http";
import { getTaskDetail } from "@/modules/tasks/queries";

// One task in full (TaskDetail), archived or not; 404 when it does not exist.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ids are cuids; anything longer cannot be one, so skip the query.
  return readJson(async () => (id.length > 0 && id.length <= 64 ? getTaskDetail(id) : null));
}

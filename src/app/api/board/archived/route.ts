import { readJson } from "@/modules/tasks/http";
import { getArchivedTasks } from "@/modules/tasks/queries";

// ArchivedTask[], newest-archived first.
export const dynamic = "force-dynamic";

export async function GET() {
  return readJson(getArchivedTasks);
}

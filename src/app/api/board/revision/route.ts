import { readJson } from "@/modules/tasks/http";
import { getRevision } from "@/modules/tasks/queries";

// { revision } — what open boards poll every few seconds. One indexed read.
export const dynamic = "force-dynamic";

export async function GET() {
  return readJson(async () => ({ revision: await getRevision() }));
}

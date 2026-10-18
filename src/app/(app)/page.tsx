import { Board } from "@/components/board/board";
import { requirePageUser } from "@/lib/page-auth";
import { getBoard } from "@/modules/tasks/queries";

export const dynamic = "force-dynamic";

/*
  The board. getBoard() trusts its caller to have checked who is asking, so
  the page asks before it reads anything (see requirePageUser).
*/
export default async function BoardPage() {
  const user = await requirePageUser();

  const board = await getBoard();
  return <Board initial={board} currentUser={{ id: user.id, role: user.role }} />;
}

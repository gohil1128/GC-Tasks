import { redirect } from "next/navigation";
import { Board } from "@/components/board/board";
import { currentUser } from "@/lib/auth";
import { getBoard } from "@/modules/tasks/queries";

export const dynamic = "force-dynamic";

/*
  The board. The layout turns away anyone signed out or still on a temporary
  password, but a layout and its page render in parallel — the layout's
  redirect does not stop this from running — and getBoard() trusts its caller
  to have checked. So the page asks again before it reads anything.
*/
export default async function BoardPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");

  const board = await getBoard();
  return <Board initial={board} currentUser={{ id: user.id, role: user.role }} />;
}

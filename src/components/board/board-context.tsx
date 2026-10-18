"use client";
import * as React from "react";
import { localToday } from "@/lib/dates";
import type { Actor } from "@/lib/permissions";
import type { LabelDTO, BoardMember, Status, TaskCard } from "@/modules/tasks/types";

/*
  What every card needs from the board without it being threaded through the
  columns: who is looking (for the permission checks that decide which
  controls to show), the people and labels to draw, today's date, and the
  board's write handlers. The handlers object is stable, so a card's menu
  does not change identity every time the board re-renders.
*/

export type BoardActions = {
  open: (id: string) => void;
  move: (card: TaskCard, to: Status) => void;
  join: (card: TaskCard) => void;
  leave: (card: TaskCard) => void;
  archive: (card: TaskCard) => void;
  requestDelete: (card: TaskCard) => void;
};

export type BoardContextValue = {
  actor: Actor;
  members: Map<string, BoardMember>;
  labels: Map<string, LabelDTO>;
  /** The viewer's calendar day, or null while rendering on the server. */
  today: string | null;
  actions: BoardActions;
};

const BoardContext = React.createContext<BoardContextValue | null>(null);

export const BoardProvider = BoardContext.Provider;

export function useBoard(): BoardContextValue {
  const value = React.useContext(BoardContext);
  if (!value) throw new Error("useBoard() outside the board");
  return value;
}

export { TEMP_PREFIX, isTempId } from "./board-logic";

function subscribeToClock(onChange: () => void): () => void {
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
}

/**
  The reader's calendar day, "YYYY-MM-DD". Null during server rendering:
  the server's clock and time zone are not the reader's, and guessing would
  colour a due date one way on the server and another after hydration. It
  re-reads every minute so a board left open overnight rolls over.
*/
export function useToday(): string | null {
  return React.useSyncExternalStore(subscribeToClock, localToday, () => null);
}

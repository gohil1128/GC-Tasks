import { AsyncLocalStorage } from "node:async_hooks";
import type { ActivityType } from "@/modules/tasks/types";

/*
  Carrying "what this board write did" out of the transaction.

  Activity rows are written inside the write's transaction (see log() in
  modules/tasks/service.ts), but a push notification must only be sent once
  that transaction has COMMITTED — a rolled-back write must never announce
  itself. So log() also drops each entry into this request-scoped store,
  and boardWrite(), which owns the transaction, reads the store back after
  commit and hands the entries to the dispatcher. Outside a board write
  (tests calling a service directly) there is no store and capture is a
  no-op.
*/

export type PendingActivity = {
  taskId: string;
  actorId: string;
  type: ActivityType;
  detail: Record<string, unknown>;
};

export type ActivityCapture = { entries: PendingActivity[] };

const storage = new AsyncLocalStorage<ActivityCapture>();

/** Called by log() for every activity row it writes. */
export function captureActivity(entry: PendingActivity): void {
  storage.getStore()?.entries.push(entry);
}

/** Runs `fn` with a fresh capture store and gives the store back with its result. */
export async function withActivityCapture<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; entries: PendingActivity[] }> {
  const store: ActivityCapture = { entries: [] };
  const result = await storage.run(store, fn);
  return { result, entries: store.entries };
}

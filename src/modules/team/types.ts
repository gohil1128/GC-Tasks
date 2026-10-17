import type { Member } from "@/modules/tasks/types";

/** A row on the Team page: a Member plus what only an owner needs to see. Plain JSON, client-safe. */
export type TeamMember = Member & { mustChangePassword: boolean; createdAt: string };

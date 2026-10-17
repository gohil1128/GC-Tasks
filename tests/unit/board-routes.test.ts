import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The read endpoints' gate and headers, with the session and the database
  stubbed out: what matters here is the status each kind of caller gets and
  that nothing is cacheable.
*/

const requireUser = vi.fn();
vi.mock("@/lib/auth", () => ({ requireUser: () => requireUser() }));

const getTaskDetail = vi.fn();
vi.mock("@/modules/tasks/queries", () => ({
  getBoard: async () => ({ revision: 7, tasks: [], members: [], labels: [] }),
  getRevision: async () => 7,
  getArchivedTasks: async () => [],
  getTaskDetail: (id: string) => getTaskDetail(id),
}));

const board = await import("@/app/api/board/route");
const revision = await import("@/app/api/board/revision/route");
const archived = await import("@/app/api/board/archived/route");
const task = await import("@/app/api/tasks/[id]/route");

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: "u1", role: "STAFF" });
  getTaskDetail.mockReset();
});

describe("board read routes", () => {
  it("serve signed-in people, uncached", async () => {
    const res = await board.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).revision).toBe(7);

    expect(await (await revision.GET()).json()).toEqual({ revision: 7 });
    expect(await (await archived.GET()).json()).toEqual([]);
    for (const mod of [board, revision, archived, task]) expect(mod.dynamic).toBe("force-dynamic");
  });

  it("answer 401 to the signed out and 403 to a password still to change", async () => {
    requireUser.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const out = await board.GET();
    expect(out.status).toBe(401);
    expect(await out.json()).toEqual({ error: "UNAUTHORIZED" });

    requireUser.mockRejectedValueOnce(new Error("PASSWORD_CHANGE_REQUIRED"));
    const change = await revision.GET();
    expect(change.status).toBe(403);
    expect(await change.json()).toEqual({ error: "PASSWORD_CHANGE_REQUIRED" });
    expect(change.headers.get("cache-control")).toBe("no-store");
  });

  it("let a real fault surface rather than dress it up as a status", async () => {
    requireUser.mockRejectedValueOnce(new Error("database is down"));
    await expect(board.GET()).rejects.toThrow("database is down");
  });

  it("return a task, or 404 for one that does not exist", async () => {
    getTaskDetail.mockResolvedValueOnce({ id: "t1", title: "Chai" });
    const found = await task.GET(new Request("http://x/api/tasks/t1"), params("t1"));
    expect(found.status).toBe(200);
    expect((await found.json()).title).toBe("Chai");

    getTaskDetail.mockResolvedValueOnce(null);
    expect((await task.GET(new Request("http://x"), params("gone"))).status).toBe(404);

    const tooLong = await task.GET(new Request("http://x"), params("x".repeat(65)));
    expect(tooLong.status).toBe(404);
    expect(getTaskDetail).toHaveBeenCalledTimes(2);
  });
});

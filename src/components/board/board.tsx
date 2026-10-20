"use client";
import * as React from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type KeyboardCoordinateGetter,
  type PointerSensorOptions,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Archive, History, MoreHorizontal, SearchX } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { NewTaskDialog } from "@/components/task/new-task-dialog";
import { TaskDialog } from "@/components/task/task-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { runAction } from "@/lib/action-client";
import { canArchiveOrDelete, canCreateTask, isOwner, type Actor } from "@/lib/permissions";
import {
  archiveDoneAction,
  archiveTaskAction,
  createTaskAction,
  deleteTaskAction,
  joinTaskAction,
  leaveTaskAction,
  moveTaskAction,
} from "@/modules/tasks/actions";
import {
  STATUSES,
  STATUS_LABEL,
  type ActionResult,
  type BoardData,
  type Status,
  type TaskCard,
} from "@/modules/tasks/types";
import { ArchivedPanel } from "./archived-panel";
import { BoardColumn, statusOfDroppable } from "./board-column";
import { BoardProvider, TEMP_PREFIX, isTempId, useToday, type BoardActions } from "./board-context";
import {
  ME,
  NO_FILTERS,
  columnsOf,
  filterTasks,
  findColumn,
  hasFilters,
  liveFilters,
  landedBetween,
  moveToColumn,
  moveToTop,
  neighboursFor,
  optimisticPosition,
  placeAmongVisible,
  removeTask,
  sortTasks,
  upsertTask,
  type BoardFilters,
  type Columns,
} from "./board-logic";
import { BoardToolbar } from "./board-toolbar";
import { ColumnTabs } from "./column-tabs";
import { StaffNotice } from "./staff-notice";
import { DraggedCard } from "./task-card";
import { useBoardSync } from "./use-board-sync";

// ── Drag set-up ─────────────────────────────────────────────────────────────

/*
  PointerSensor would claim touches too — its pointerdown arrives before the
  TouchSensor's touchstart — and on a touch screen a finger that travels 6px
  is scrolling the column, not dragging a card. So this one answers mouse
  and pen only, and touches go to the TouchSensor, which waits for a press.
*/
class MouseOrPenSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: React.PointerEvent, { onActivation }: PointerSensorOptions) => {
        if (event.pointerType === "touch" || !event.isPrimary || event.button !== 0) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

/** Space picks a card up; Enter is left free to open it. */
const KEYBOARD_CODES = { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] };

function laidOut(rect: { width: number; height: number } | undefined): boolean {
  return !!rect && rect.width > 0 && rect.height > 0;
}

/*
  Arrow keys during a keyboard drag. dnd-kit's sortable version goes to the
  nearest droppable on the pressed side, measured by left edge — and the
  card's own column tray starts left of the card, so Left from Done "moves"
  into Done and goes nowhere. Narrowed first, then handed over:
    - on a phone the other two columns are display:none, measuring 0×0 at
      the top-left corner, close to everything; anything not laid out is out
      (the collision check skips them too);
    - a column holding cards is reached through its cards, so the card lands
      next to one; only an empty column is a target itself;
    - Left and Right only consider what lies wholly to that side.
*/
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, collisionRect, droppableRects, droppableContainers } = args.context;
  const filled = new Set<string>();
  for (const entry of droppableContainers.getEnabled()) {
    const sortable = entry.data.current?.sortable as { containerId: UniqueIdentifier } | undefined;
    if (sortable && entry.id !== active?.id && laidOut(droppableRects.get(entry.id))) {
      filled.add(String(sortable.containerId));
    }
  }
  const rects: typeof droppableRects = new Map();
  for (const [id, rect] of droppableRects) {
    if (!laidOut(rect)) continue;
    const column = statusOfDroppable(String(id));
    if (column && filled.has(column)) continue;
    if (collisionRect && event.code === "ArrowLeft" && rect.left + rect.width > collisionRect.left) continue;
    if (collisionRect && event.code === "ArrowRight" && rect.left < collisionRect.left + collisionRect.width) continue;
    rects.set(id, rect);
  }
  return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context, droppableRects: rects } });
};

const SCREEN_READER: ScreenReaderInstructions = {
  draggable:
    "Press Enter to open this card. To move it, press Space to pick it up, use the arrow keys to move it within a column or to the next column, then press Space to drop it, or Escape to cancel.",
};

/*
  While the lifted copy glides into its slot it sits exactly over the real
  card, so it lets presses through: otherwise grabbing the card again within
  that quarter-second lands on the copy and nothing happens. A class rather
  than a style: dnd-kit applies `styles` with style.setProperty(), which
  wants "pointer-events", not the camelCase key its types ask for.
*/
const DROP_ANIMATION: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.4" } },
    className: { dragOverlay: "pointer-events-none" },
  }),
};

type DragState = { activeId: string; origin: Status; columns: Columns };

type Confirm = { kind: "delete"; card: TaskCard } | { kind: "archiveDone"; count: number } | null;

const PEOPLE_PREF = "gc-tasks:board:people";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest("input, textarea, select, [contenteditable='true']");
}

/** Keeps a ref pointed at the latest render's value, for handlers that run later. */
function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = React.useRef(value);
  React.useEffect(() => {
    ref.current = value;
  });
  return ref;
}

// ── The board ───────────────────────────────────────────────────────────────

/*
  The board screen. Holds the board as the server last described it, plus
  the viewer's own changes on top: every write is applied here at once and
  then sent; the server's answer replaces the card (or, on refusal, the card
  is put back and the board fetched again). use-board-sync brings in other
  people's changes, and is told about every write so a poll never lands on
  top of one that is still in flight.
*/
export function Board({ initial, currentUser }: { initial: BoardData; currentUser: Actor }) {
  const actor = currentUser;
  const owner = isOwner(actor);
  const canCreate = canCreateTask(actor);

  const [board, setBoard] = React.useState<BoardData>(initial);
  const [picked, setFilters] = React.useState<BoardFilters>(NO_FILTERS);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [mobileColumn, setMobileColumn] = React.useState<Status>("TODO");
  const [quickAddColumn, setQuickAddColumn] = React.useState<Status | null>(null);
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = React.useState(false);
  const [archivedOpen, setArchivedOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<Confirm>(null);

  const sync = useBoardSync({ initialRevision: initial.revision, onBoard: setBoard });
  const today = useToday();

  // Arriving from a notification — a bell click or a phone push — names
  // the task in the URL (/?task=<id>): open it, then take the parameter
  // off the URL so a refresh does not reopen it.
  React.useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("task");
    if (!id) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (initial.tasks.some((t) => t.id === id)) setOpenTaskId(id);
    // Mount only: `initial` is the board exactly as the server sent it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchRef = React.useRef<HTMLInputElement>(null);
  const todoAddRef = React.useRef<HTMLInputElement>(null);
  const tempSeq = React.useRef(0);
  // dragRef is the drag as the handlers last left it, which can be ahead of
  // the `drag` state React has rendered.
  const dragRef = React.useRef<DragState | null>(null);
  const lastOverId = React.useRef<UniqueIdentifier | null>(null);
  const recentlyMovedColumn = React.useRef(false);
  const dropStatus = React.useRef<Status | null>(null);

  // ── Derived ──

  const taskById = React.useMemo(() => new Map(board.tasks.map((t) => [t.id, t])), [board.tasks]);
  const membersById = React.useMemo(() => new Map(board.members.map((m) => [m.id, m])), [board.members]);
  const labelsById = React.useMemo(() => new Map(board.labels.map((l) => [l.id, l])), [board.labels]);
  // The people worth offering in the filter: anyone active, plus anyone
  // deactivated who is still on a card. The viewer is "My tasks".
  const filterMembers = React.useMemo(
    () =>
      board.members.filter(
        (m) => m.id !== actor.id && (m.active || board.tasks.some((t) => t.assigneeIds.includes(m.id))),
      ),
    [board.members, board.tasks, actor.id],
  );

  // What is picked, less labels and people that have since gone (see liveFilters).
  const filters = React.useMemo(
    () => liveFilters(picked, new Set(labelsById.keys()), new Set(filterMembers.map((m) => m.id))),
    [picked, labelsById, filterMembers],
  );
  const baseColumns = React.useMemo(() => columnsOf(board.tasks), [board.tasks]);
  const columns = drag?.columns ?? baseColumns;
  const filtering = hasFilters(filters);

  const visibleIds = React.useMemo(
    () =>
      new Set(
        filterTasks(board.tasks, filters, { currentUserId: actor.id, labels: board.labels }).map((t) => t.id),
      ),
    [board.tasks, board.labels, filters, actor.id],
  );

  const visibleColumns = React.useMemo(() => {
    const out = {} as Record<Status, TaskCard[]>;
    for (const s of STATUSES) {
      out[s] = columns[s].flatMap((id) => {
        const card = taskById.get(id);
        // The card being dragged stays on screen even if an edit elsewhere
        // has just filtered it out from under the pointer.
        return card && (visibleIds.has(id) || id === drag?.activeId) ? [card] : [];
      });
    }
    return out;
  }, [columns, taskById, visibleIds, drag?.activeId]);

  const totals = React.useMemo(
    () => ({ TODO: columns.TODO.length, IN_PROGRESS: columns.IN_PROGRESS.length, DONE: columns.DONE.length }),
    [columns],
  );
  const shownCount = STATUSES.reduce((n, s) => n + visibleColumns[s].length, 0);
  const noMatches = filtering && board.tasks.length > 0 && shownCount === 0;
  const doneCount = board.tasks.filter((t) => t.status === "DONE" && !isTempId(t.id)).length;

  const boardRef = useLatest(board);
  const baseColumnsRef = useLatest(baseColumns);
  const visibleIdsRef = useLatest(visibleIds);
  const taskByIdRef = useLatest(taskById);

  // ── Remembered "My tasks" ──

  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(PEOPLE_PREF) === "mine") {
        setFilters((f) => (f.people.length === 0 ? { ...f, people: [ME] } : f));
      }
    } catch {
      // Storage blocked: start from Everyone.
    }
  }, []);

  const changeFilters = React.useCallback((next: BoardFilters) => {
    setFilters(next);
    try {
      const mine = next.people.length === 1 && next.people[0] === ME;
      window.localStorage.setItem(PEOPLE_PREF, mine ? "mine" : "everyone");
    } catch {
      // Not remembered; nothing else depends on it.
    }
  }, []);

  // ── Local edits ──

  const applyCard = React.useCallback((card: TaskCard) => {
    setBoard((b) => ({
      ...b,
      tasks: card.archivedAt ? removeTask(b.tasks, card.id) : upsertTask(b.tasks, card),
    }));
  }, []);

  const dropCard = React.useCallback((id: string) => {
    setBoard((b) => ({ ...b, tasks: removeTask(b.tasks, id) }));
  }, []);

  /** A write was refused or never arrived: put the card back as it was and re-read the board. */
  const rollback = React.useCallback(
    (prev: TaskCard) => {
      applyCard(prev);
      sync.refresh();
    },
    [applyCard, sync],
  );

  /** The common tail of a write that returns the card. */
  const settle = React.useCallback(
    (result: ActionResult<TaskCard>, prev: TaskCard): result is { ok: true; data: TaskCard; revision: number } => {
      if (!result.ok) {
        rollback(prev);
        return false;
      }
      applyCard(result.data);
      sync.noteRevision(result.revision);
      return true;
    },
    [applyCard, rollback, sync],
  );

  async function commitMove(
    card: TaskCard,
    to: Status,
    afterId: string | null,
    beforeId: string | null,
    via: "drag" | "menu",
  ) {
    const now = new Date().toISOString();
    // Mirrors the server: an unassigned card dragged into In progress becomes the mover's.
    const claims = to === "IN_PROGRESS" && card.status !== "IN_PROGRESS" && card.assigneeIds.length === 0;
    applyCard({
      ...card,
      status: to,
      position: optimisticPosition(boardRef.current.tasks, afterId, beforeId),
      assigneeIds: claims ? [actor.id] : card.assigneeIds,
      completedAt: to === "DONE" ? (card.completedAt ?? now) : null,
    });

    const result = await sync.track(runAction(moveTaskAction({ id: card.id, status: to, afterId, beforeId })));
    if (!settle(result, card)) return;

    // The server renumbers a column when a gap runs out, and someone else may
    // have moved a neighbour meanwhile; either way, re-read rather than guess.
    if (!landedBetween(boardRef.current.tasks, result.data, afterId, beforeId)) sync.refresh();

    const assignedNow = !card.assigneeIds.includes(actor.id) && result.data.assigneeIds.includes(actor.id);
    if (to === "IN_PROGRESS" && card.status !== "IN_PROGRESS" && assignedNow) {
      toast.success("Assigned to you", via === "menu" ? { description: "Moved to In progress." } : undefined);
    } else if (via === "menu" && card.status !== to) {
      toast.success(`Moved to ${STATUS_LABEL[to]}.`);
    }
  }

  async function quickAdd(title: string, status: Status): Promise<boolean> {
    const tempId = `${TEMP_PREFIX}${++tempSeq.current}`;
    const now = new Date().toISOString();
    const top = baseColumnsRef.current[status][0] ?? null;
    const temp: TaskCard = {
      id: tempId,
      title,
      description: "",
      status,
      position: optimisticPosition(boardRef.current.tasks, null, top),
      priority: "MEDIUM",
      dueDate: null,
      version: 1,
      completedAt: status === "DONE" ? now : null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      createdById: actor.id,
      updatedById: actor.id,
      assigneeIds: [],
      labelIds: [],
      checklistDone: 0,
      checklistTotal: 0,
      commentCount: 0,
    };
    applyCard(temp);
    const result = await sync.track(runAction(createTaskAction({ title, status })));
    setBoard((b) => {
      const without = removeTask(b.tasks, tempId);
      return { ...b, tasks: result.ok ? upsertTask(without, result.data) : without };
    });
    if (result.ok) sync.noteRevision(result.revision);
    else sync.refresh();
    return result.ok;
  }

  function moveViaMenu(card: TaskCard, to: Status) {
    if (card.status === to) return;
    const next = moveToTop(baseColumnsRef.current, card.id, to);
    const { afterId, beforeId } = neighboursFor(next[to], card.id);
    void commitMove(card, to, afterId, beforeId, "menu");
  }

  async function join(card: TaskCard) {
    applyCard({ ...card, assigneeIds: [...card.assigneeIds, actor.id] });
    settle(await sync.track(runAction(joinTaskAction(card.id))), card);
  }

  async function leave(card: TaskCard) {
    applyCard({ ...card, assigneeIds: card.assigneeIds.filter((id) => id !== actor.id) });
    settle(await sync.track(runAction(leaveTaskAction(card.id))), card);
  }

  async function archive(card: TaskCard) {
    dropCard(card.id);
    const result = await sync.track(runAction(archiveTaskAction(card.id)));
    if (!result.ok) {
      rollback(card);
      return;
    }
    sync.noteRevision(result.revision);
    toast.success("Task archived.", { description: "Find it under Done → Show archived." });
  }

  async function deleteCard(card: TaskCard): Promise<boolean> {
    dropCard(card.id);
    const result = await sync.track(runAction(deleteTaskAction(card.id)));
    if (!result.ok) {
      // Already gone is what was wanted; anything else puts the card back.
      if (result.code === "NOT_FOUND") {
        sync.refresh();
        return true;
      }
      rollback(card);
      return false;
    }
    sync.noteRevision(result.revision);
    toast.success("Task deleted.");
    return true;
  }

  async function archiveAllDone(): Promise<boolean> {
    const done = boardRef.current.tasks.filter((t) => t.status === "DONE" && !isTempId(t.id));
    const doneIds = new Set(done.map((t) => t.id));
    setBoard((b) => ({ ...b, tasks: b.tasks.filter((t) => !doneIds.has(t.id)) }));
    const result = await sync.track(runAction(archiveDoneAction()));
    if (!result.ok) {
      setBoard((b) => ({ ...b, tasks: sortTasks([...b.tasks.filter((t) => !doneIds.has(t.id)), ...done]) }));
      sync.refresh();
      return false;
    }
    sync.noteRevision(result.revision);
    // The server archives whatever is in Done when the write runs — possibly a
    // card someone else dropped there a moment ago.
    if (result.data.count !== done.length) sync.refresh();
    toast.success(result.data.count === 1 ? "Archived 1 task." : `Archived ${result.data.count} tasks.`);
    return true;
  }

  // Cards call these through context; the object itself never changes, so
  // the menus do not either.
  const handlers = {
    open: (id: string) => setOpenTaskId(id),
    move: moveViaMenu,
    join: (card: TaskCard) => void join(card),
    leave: (card: TaskCard) => void leave(card),
    archive: (card: TaskCard) => void archive(card),
    requestDelete: (card: TaskCard) => setConfirm({ kind: "delete", card }),
  } satisfies BoardActions;
  const handlersRef = useLatest(handlers);
  const actions = React.useMemo<BoardActions>(
    () => ({
      open: (id) => handlersRef.current.open(id),
      move: (card, to) => handlersRef.current.move(card, to),
      join: (card) => handlersRef.current.join(card),
      leave: (card) => handlersRef.current.leave(card),
      archive: (card) => handlersRef.current.archive(card),
      requestDelete: (card) => handlersRef.current.requestDelete(card),
    }),
    [handlersRef],
  );

  const context = React.useMemo(
    () => ({ actor, members: membersById, labels: labelsById, today, actions }),
    [actor, membersById, labelsById, today, actions],
  );

  // ── Dragging ──

  const sensors = useSensors(
    useSensor(MouseOrPenSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, keyboardCodes: KEYBOARD_CODES }),
  );

  function updateDrag(next: DragState | null) {
    dragRef.current = next;
    setDrag(next);
  }

  React.useEffect(() => {
    // A card that has just changed column has not been measured there yet;
    // until it has, the collision check keeps pointing at it.
    const frame = requestAnimationFrame(() => {
      recentlyMovedColumn.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [drag?.columns]);

  /*
    Pointer first, so the card under the finger wins; failing that whatever
    the dragged card overlaps. Landing on a column's own tray (its empty space,
    or its header) is narrowed to the nearest card in it, so the card slots
    in next to that one rather than always jumping to the bottom.
  */
  const collisionDetection: CollisionDetection = React.useCallback((args) => {
    const containers = args.droppableContainers.filter((c) => laidOut(args.droppableRects.get(c.id)));
    const scoped = { ...args, droppableContainers: containers };
    const pointerHits = pointerWithin(scoped);
    const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(scoped);
    let overId = getFirstCollision(hits, "id");

    if (overId != null) {
      const status = statusOfDroppable(String(overId));
      const cols = dragRef.current?.columns;
      if (status && cols) {
        const inColumn = containers.filter((c) => c.id !== overId && cols[status].includes(String(c.id)));
        if (inColumn.length > 0) {
          overId = closestCenter({ ...scoped, droppableContainers: inColumn })[0]?.id ?? overId;
        }
      }
      lastOverId.current = overId;
      return [{ id: overId }];
    }

    if (recentlyMovedColumn.current) lastOverId.current = args.active.id;
    return lastOverId.current != null ? [{ id: lastOverId.current }] : [];
  }, []);

  function handleDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    const origin = findColumn(baseColumnsRef.current, id);
    if (!origin) return;
    lastOverId.current = null;
    dropStatus.current = null;
    sync.setDragging(true);
    updateDrag({ activeId: id, origin, columns: baseColumnsRef.current });
  }

  /** Live preview: the card hops to the column it is over while still in the air. */
  function handleDragOver({ active, over }: DragOverEvent) {
    const d = dragRef.current;
    if (!d || !over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = findColumn(d.columns, activeId);
    const overColumn = statusOfDroppable(overId);
    const to = overColumn ?? findColumn(d.columns, overId);
    if (!from || !to || from === to) return;

    let anchor: string | null = null;
    let after = false;
    if (!overColumn) {
      anchor = overId;
      const dragged = active.rect.current.translated;
      after = !!dragged && dragged.top > over.rect.top + over.rect.height;
    }
    recentlyMovedColumn.current = true;
    updateDrag({ ...d, columns: moveToColumn(d.columns, activeId, to, anchor, after) });
    // On a phone only one column is on screen: when the drag reaches another
    // column (through its tab), show that column so the card can be placed
    // exactly where it belongs. Harmless on desktop, where every column shows.
    if (to !== mobileColumn) setMobileColumn(to);
  }

  function finishDrag() {
    updateDrag(null);
    sync.setDragging(false);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    const d = dragRef.current;
    const activeId = String(active.id);
    const card = taskByIdRef.current.get(activeId);
    const status = d ? findColumn(d.columns, activeId) : null;
    dropStatus.current = over ? status : (d?.origin ?? null);
    if (!d || !over || !card || !status) {
      finishDrag();
      return;
    }

    // Reordering happens among the cards on screen; it is then carried over
    // to the full column so the cards a filter hides keep their places. The
    // column is the one snapshotted at pick-up, so anything a write settled
    // off the board since then is left out of it first.
    let columnIds = d.columns[status].filter((id) => taskByIdRef.current.has(id));
    const overId = String(over.id);
    if (overId !== activeId && columnIds.includes(overId)) {
      const visible = columnIds.filter((id) => id === activeId || visibleIdsRef.current.has(id));
      const from = visible.indexOf(activeId);
      const to = visible.indexOf(overId);
      if (from >= 0 && to >= 0 && from !== to) {
        columnIds = placeAmongVisible(columnIds, arrayMove(visible, from, to), activeId);
      }
    }

    const { afterId, beforeId } = neighboursFor(columnIds, activeId);
    const was = neighboursFor(baseColumnsRef.current[card.status], activeId);
    const unchanged = status === card.status && afterId === was.afterId && beforeId === was.beforeId;
    // The move is applied before the drag is cleared, so the board never
    // flashes the card back in its old place for a frame.
    if (!unchanged) void commitMove(card, status, afterId, beforeId, "drag");
    finishDrag();
  }

  const announcements = React.useMemo<Announcements>(() => {
    const title = (id: UniqueIdentifier) => {
      const t = taskByIdRef.current.get(String(id))?.title;
      return t ? `“${t}”` : "The card";
    };
    const where = (overId: UniqueIdentifier) => {
      const column = statusOfDroppable(String(overId));
      if (column) return STATUS_LABEL[column];
      const cols = dragRef.current?.columns;
      const status = cols ? findColumn(cols, String(overId)) : null;
      if (!cols || !status) return "another card";
      const visible = cols[status].filter((id) => visibleIdsRef.current.has(id) || id === dragRef.current?.activeId);
      return `${STATUS_LABEL[status]}, position ${visible.indexOf(String(overId)) + 1} of ${visible.length}`;
    };
    return {
      onDragStart: ({ active }) => {
        const origin = dragRef.current?.origin;
        return `Picked up ${title(active.id)}${origin ? ` in ${STATUS_LABEL[origin]}` : ""}.`;
      },
      onDragOver: ({ active, over }) =>
        over ? `${title(active.id)} is over ${where(over.id)}.` : `${title(active.id)} is not over a column.`,
      onDragEnd: ({ active, over }) => {
        const s = dropStatus.current;
        if (!over) return `${title(active.id)} was put back${s ? ` in ${STATUS_LABEL[s]}` : ""}.`;
        return `${title(active.id)} was dropped in ${s ? STATUS_LABEL[s] : "its column"}.`;
      },
      onDragCancel: ({ active }) => {
        const origin = dragRef.current?.origin;
        return `Moving ${title(active.id)} was cancelled.${origin ? ` It is back in ${STATUS_LABEL[origin]}.` : ""}`;
      },
    };
  }, [taskByIdRef, visibleIdsRef]);

  // ── Keyboard shortcuts ──

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || dragRef.current) return;
      // Leave keys alone while a dialog or menu has the floor.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "n" && canCreate) {
        event.preventDefault();
        setNewTaskOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canCreate]);

  // ── Render ──

  const activeCard = drag ? taskById.get(drag.activeId) : undefined;
  const previewStatus = drag ? findColumn(drag.columns, drag.activeId) : null;

  function openQuickAdd(status: Status, open: boolean) {
    if (status === "TODO") {
      if (open) todoAddRef.current?.focus();
      return;
    }
    setQuickAddColumn(open ? status : (current) => (current === status ? null : current));
  }

  const doneMenu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="More for Done">
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {canArchiveOrDelete(actor) && (
          <DropdownMenuItem
            disabled={doneCount === 0}
            onSelect={() => setConfirm({ kind: "archiveDone", count: doneCount })}
          >
            <Archive className="h-4 w-4 text-muted-foreground" aria-hidden />
            Archive all done
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setArchivedOpen(true)}>
          <History className="h-4 w-4 text-muted-foreground" aria-hidden />
          Show archived
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <BoardProvider value={context}>
      <div className="flex min-h-0 flex-1 flex-col">
        <BoardToolbar
          filters={filters}
          onFiltersChange={changeFilters}
          members={filterMembers}
          labels={board.labels}
          currentUserId={actor.id}
          canCreate={canCreate}
          onNewTask={() => setNewTaskOpen(true)}
          searchRef={searchRef}
          refreshing={sync.refreshing}
          offline={sync.offline}
          onRefresh={sync.refresh}
        />

        {!owner && <StaffNotice />}

        {noMatches && (
          <div
            role="status"
            className="mx-4 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground sm:mx-6"
          >
            <SearchX className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">No tasks match these filters.</span>
            <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => changeFilters(NO_FILTERS)}>
              Clear filters
            </Button>
          </div>
        )}

        {/* A fixed id: without one dnd-kit numbers its aria-describedby ids from
            a module counter, which the server and the browser count differently. */}
        <DndContext
          id="board"
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={finishDrag}
          accessibility={{ announcements, screenReaderInstructions: SCREEN_READER }}
        >
          {/* Inside the DnD context so the phone's column tabs can be drop
              targets; DndContext renders no wrapper, so the layout is unchanged. */}
          <ColumnTabs
            active={mobileColumn}
            counts={{
              TODO: visibleColumns.TODO.length,
              IN_PROGRESS: visibleColumns.IN_PROGRESS.length,
              DONE: visibleColumns.DONE.length,
            }}
            onChange={setMobileColumn}
          />
          <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 md:grid md:grid-cols-3 md:grid-rows-[minmax(0,1fr)] md:pb-6">
            {STATUSES.map((status) => (
              <BoardColumn
                key={status}
                status={status}
                cards={visibleColumns[status]}
                total={totals[status]}
                filtering={filtering}
                shown={mobileColumn === status}
                highlighted={drag !== null && previewStatus === status && drag.origin !== status}
                dragging={drag !== null}
                canCreate={canCreate}
                quickAddOpen={quickAddColumn === status}
                onQuickAddOpenChange={(open) => openQuickAdd(status, open)}
                onAdd={quickAdd}
                quickAddRef={status === "TODO" ? todoAddRef : undefined}
                headerMenu={status === "DONE" ? doneMenu : undefined}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={DROP_ANIMATION}>
            {activeCard ? <DraggedCard card={activeCard} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      <TaskDialog
        taskId={openTaskId}
        board={board}
        currentUserId={actor.id}
        onOpenChange={(open) => {
          if (!open) setOpenTaskId(null);
        }}
        onTaskChanged={(card, revision) => {
          applyCard(card);
          if (revision !== null) sync.noteRevision(revision);
        }}
        onTaskRemoved={(id, revision) => {
          dropCard(id);
          sync.noteRevision(revision);
        }}
        onBoardStale={sync.refresh}
      />

      {canCreate && (
        <NewTaskDialog
          open={newTaskOpen}
          onOpenChange={setNewTaskOpen}
          board={board}
          currentUserId={actor.id}
          defaultStatus="TODO"
          onCreated={(card, revision) => {
            applyCard(card);
            sync.noteRevision(revision);
            // On a phone, show the column the new card went into.
            setMobileColumn(card.status);
          }}
          onBoardStale={sync.refresh}
        />
      )}

      <ArchivedPanel
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
        track={sync.track}
        onRestored={(card, revision) => {
          applyCard(card);
          sync.noteRevision(revision);
        }}
        onDeleted={(_id, revision) => sync.noteRevision(revision)}
        onOpenTask={(id) => {
          setArchivedOpen(false);
          setOpenTaskId(id);
        }}
      />

      <ConfirmDialog
        open={confirm?.kind === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete this task?"
        description={
          confirm?.kind === "delete" ? (
            <>
              <p>
                &ldquo;{confirm.card.title}&rdquo; will be deleted along with its checklist, comments and history.
              </p>
              <p>This can&apos;t be undone. To keep it but take it off the board, archive it instead.</p>
            </>
          ) : null
        }
        confirmLabel="Delete task"
        pendingLabel="Deleting…"
        destructive
        onConfirm={async () => (confirm?.kind === "delete" ? deleteCard(confirm.card) : true)}
      />

      <ConfirmDialog
        open={confirm?.kind === "archiveDone"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Archive everything in Done?"
        description={
          <p>
            {confirm?.kind === "archiveDone" && confirm.count === 1
              ? "The 1 task in Done leaves the board."
              : `The ${confirm?.kind === "archiveDone" ? confirm.count : doneCount} tasks in Done leave the board.`}{" "}
            They are kept with their history, and can be restored from Show archived.
          </p>
        }
        confirmLabel="Archive all"
        pendingLabel="Archiving…"
        onConfirm={archiveAllDone}
      />
    </BoardProvider>
  );
}

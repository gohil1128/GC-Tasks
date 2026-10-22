"use client";
import * as React from "react";
import { AlertTriangle, Archive, ArchiveRestore, Hand, LogOut, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { useBackToClose } from "@/components/ui/back-to-close";
import { useSwipeBack } from "@/components/ui/swipe-back";
import { runAction } from "@/lib/action-client";
import type { ColorKey } from "@/lib/colors";
import { localToday, shortDay } from "@/lib/dates";
import {
  canArchiveOrDelete,
  canComment,
  canEditTask,
  canJoinTask,
  canLeaveTask,
  canManageLabels,
  canMoveTask,
  canWorkChecklist,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { createLabelAction } from "@/modules/labels/actions";
import {
  addChecklistItemAction,
  addCommentAction,
  archiveTaskAction,
  deleteChecklistItemAction,
  deleteCommentAction,
  deleteTaskAction,
  editCommentAction,
  joinTaskAction,
  leaveTaskAction,
  moveTaskAction,
  restoreTaskAction,
  updateChecklistItemAction,
  updateTaskAction,
} from "@/modules/tasks/actions";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type BoardData,
  type ChecklistItemDTO,
  type LabelDTO,
  type Status,
  type TaskCard,
} from "@/modules/tasks/types";
import { ActivityList } from "./activity-list";
import { AssigneePicker } from "./assignee-picker";
import { Checklist } from "./checklist";
import { Comments } from "./comments";
import { DueDateField } from "./due-date-field";
import { FieldLabel } from "./field";
import { isSubmitShortcut, useAutoGrow, useLatest, useNow, useStateRef } from "./hooks";
import { LabelPicker } from "./label-picker";
import { PrioritySelect } from "./priority-select";
import { StatusSelect } from "./status-select";
import {
  SCALAR_FIELDS,
  actorFor,
  addConflict,
  applyChecklistChange,
  bylines,
  cardFingerprint,
  cardOf,
  checklistCounts,
  cleanTitle,
  contentOf,
  dropConflictField,
  freshestCard,
  hasFields,
  isAtLeastAsFresh,
  mergeDetail,
  mergeLabels,
  omitFields,
  planSave,
  revertItem,
  settlePending,
  showCard,
  tempId,
  topOfColumn,
  wasAutoAssigned,
  withCard,
  type Conflict,
  type ContentPatch,
  type ScalarField,
  type ScalarPatch,
} from "./task-logic";
import { useTaskDetail } from "./use-task-detail";

export type TaskDialogProps = {
  /** The task to show; null means closed. */
  taskId: string | null;
  /** The board as the parent currently holds it — members and labels for the pickers, and the card for a first paint before the detail loads. */
  board: BoardData;
  currentUserId: string;
  onOpenChange: (open: boolean) => void;
  /**
    Any write that changed the card (fields, people, labels, checklist counts,
    comment count, status). `revision` is null when the card is the dialog's
    best guess rather than the server's word — the parent should show it but
    not count the write as seen, so its next poll fetches the truth.
  */
  onTaskChanged: (card: TaskCard, revision: number | null) => void;
  /** The task was deleted or archived and should leave the board. */
  onTaskRemoved: (id: string, revision: number) => void;
  /** Labels were created/edited/deleted from inside the dialog; the parent should refetch the board. */
  onBoardStale: () => void;
};

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 10_000;
const SAVED_FLASH_MS = 2_000;

/**
  Escape inside a field that is being edited cancels that edit and nothing
  more. The dialog hears Escape first (Radix listens on the document, in the
  capture phase), so the field cannot stop it; instead the dialog lets an
  element marked data-escape-cancels keep it.
*/
function keepsEscape(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-escape-cancels]") !== null;
}

/**
  One task in full. Opens straight away from the card the board already has,
  then fills in the checklist, comments and history from the server.

  Owners can change everything. Staff see everything but work only what the
  rules in src/lib/permissions.ts give them: the column of a task they are
  on, its checklist, picking up an unclaimed task, and comments — the rest is
  shown as plain text rather than as controls that would be refused.
*/
export function TaskDialog({
  taskId,
  board,
  currentUserId,
  onOpenChange,
  onTaskChanged,
  onTaskRemoved,
  onBoardStale,
}: TaskDialogProps) {
  // Keep drawing the last task while the dialog animates closed.
  const [shownId, setShownId] = React.useState(taskId);
  if (taskId !== null && taskId !== shownId) setShownId(taskId);

  const contentRef = React.useRef<HTMLDivElement>(null);
  const beforeClose = React.useRef<(() => void) | null>(null);

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      // Text still being typed is saved, however the dialog is closed.
      if (!open) beforeClose.current?.();
      onOpenChange(open);
    },
    [onOpenChange],
  );
  const close = React.useCallback(() => handleOpenChange(false), [handleOpenChange]);
  const attachSwipe = useSwipeBack(close);
  useBackToClose(taskId !== null, close);
  const setContentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      attachSwipe(node);
    },
    [attachSwipe],
  );

  return (
    <Dialog open={taskId !== null} onOpenChange={handleOpenChange}>
      {shownId !== null && (
        <DialogContent
          ref={setContentRef}
          hideClose
          aria-describedby={undefined}
          className="touch-pan-y gap-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-2xl"
          // Focus the sheet itself, not the title field: landing in a text box
          // would put a phone's keyboard over the task you just opened.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (keepsEscape(event.target)) event.preventDefault();
          }}
        >
          <TaskDialogBody
            key={shownId}
            taskId={shownId}
            board={board}
            currentUserId={currentUserId}
            onTaskChanged={onTaskChanged}
            onTaskRemoved={onTaskRemoved}
            onBoardStale={onBoardStale}
            beforeClose={beforeClose}
            close={close}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

type BodyProps = Omit<TaskDialogProps, "taskId" | "onOpenChange"> & {
  taskId: string;
  beforeClose: React.MutableRefObject<(() => void) | null>;
  close: () => void;
};

const FIELD_NAME: Record<ScalarField, string> = {
  title: "title",
  description: "description",
  priority: "priority",
  dueDate: "due date",
};

function TaskDialogBody({
  taskId,
  board,
  currentUserId,
  onTaskChanged,
  onTaskRemoved,
  onBoardStale,
  beforeClose,
  close,
}: BodyProps) {
  const ids = {
    assignees: React.useId(),
    labels: React.useId(),
    priority: React.useId(),
    due: React.useId(),
    description: React.useId(),
  };
  const boardCard = board.tasks.find((t) => t.id === taskId) ?? null;
  const actor = actorFor(board.members, currentUserId);
  const now = new Date(useNow());
  const today = localToday(now);

  const boardRef = useLatest(board);
  const boardCardRef = useLatest(boardCard);
  const onTaskChangedRef = useLatest(onTaskChanged);
  const onTaskRemovedRef = useLatest(onTaskRemoved);
  const closeRef = useLatest(close);
  // The newest board revision this dialog has seen, for callbacks that need one without a write of their own.
  const lastRevision = React.useRef(board.revision);
  // Set once the task has left (deleted, archived from here, or gone missing), so nothing more is sent for it.
  const removed = React.useRef(false);

  const dropTask = React.useCallback(
    (revision: number, message?: string) => {
      if (removed.current) return;
      removed.current = true;
      if (message) toast.error(message);
      onTaskRemovedRef.current(taskId, revision);
      closeRef.current();
    },
    [taskId, onTaskRemovedRef, closeRef],
  );

  /** The task no longer exists. `quiet` when runAction has already said so. */
  const handleGone = React.useCallback(
    (quiet = false) => dropTask(lastRevision.current, quiet ? undefined : "This task was deleted"),
    [dropTask],
  );

  const reloadKey = `${cardFingerprint(boardCard)}#${board.revision}`;
  const { detail, detailRef, setDetail, status, track, reload } = useTaskDetail({
    taskId,
    reloadKey,
    onGone: () => handleGone(),
  });

  /** Content changes sent but not yet answered, drawn over the confirmed card. */
  const [pending, setPending, pendingRef] = useStateRef<ContentPatch>({});
  const [pendingStatus, setPendingStatus] = React.useState<Status | null>(null);
  const statusSeq = React.useRef(0);
  const [conflict, setConflict] = React.useState<Conflict | null>(null);
  const [extraLabels, setExtraLabels] = React.useState<LabelDTO[]>([]);
  const [saved, setSaved] = React.useState(false);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [busy, setBusy] = React.useState<"archive" | "restore" | null>(null);
  const tempSeq = React.useRef(0);

  React.useEffect(() => () => clearTimeout(savedTimer.current), []);

  // ── What is on screen ──

  /** The newest copy of the card the server has confirmed: the detail's, or the board's if that is newer. */
  const confirmedCard = React.useCallback(
    (): TaskCard | null =>
      freshestCard(detailRef.current ? cardOf(detailRef.current) : null, boardCardRef.current),
    [detailRef, boardCardRef],
  );

  const confirmed = freshestCard(detail ? cardOf(detail) : null, boardCard);
  const card: TaskCard | null = confirmed
    ? { ...showCard(confirmed, pending), status: pendingStatus ?? confirmed.status }
    : null;

  const labels = React.useMemo(() => mergeLabels(board.labels, extraLabels), [board.labels, extraLabels]);

  // ── Telling the board ──

  const announce = React.useCallback(
    (next: TaskCard, revision: number, { counted = false }: { counted?: boolean } = {}) => {
      lastRevision.current = Math.max(lastRevision.current, revision);
      const onBoard = boardCardRef.current;
      // An answer that arrives after the board has already caught up with something newer is not passed on.
      if (onBoard && !isAtLeastAsFresh(next, onBoard)) return;
      onTaskChangedRef.current(next, counted ? null : revision);
    },
    [boardCardRef, onTaskChangedRef],
  );

  const applyResult = React.useCallback(
    (next: TaskCard, revision: number) => {
      setDetail((d) => (d ? withCard(d, next) : d));
      announce(next, revision);
    },
    [setDetail, announce],
  );

  /*
    Checklist and comment counts are worked out here, from the dialog's own
    list — which can be a moment behind: a teammate's added item may already
    be on the board's card while this list has not reloaded yet. So these
    announcements are marked `counted`: the board shows them at once but does
    not take their revision as seen, and its next poll replaces the guess with
    the server's numbers. Otherwise a stale sum (2 of 2 instead of 2 of 3)
    would stay on the card until someone else happened to write.
  */
  /** Checklist counts worked out again from the items, onto the card here and on the board. */
  const syncChecklist = React.useCallback(
    (revision: number | null) => {
      const d = detailRef.current;
      const base = confirmedCard();
      if (!d || !base) return;
      const counts = checklistCounts(d.checklist);
      const same = counts.checklistDone === base.checklistDone && counts.checklistTotal === base.checklistTotal;
      if (same && revision === null) return;
      setDetail((prev) => (prev ? { ...prev, ...counts } : prev));
      announce({ ...base, ...counts }, revision ?? lastRevision.current, { counted: true });
    },
    [detailRef, confirmedCard, setDetail, announce],
  );

  const syncComments = React.useCallback(
    (revision: number) => {
      const d = detailRef.current;
      const base = confirmedCard();
      if (!d || !base) return;
      const commentCount = d.comments.length;
      setDetail((prev) => (prev ? { ...prev, commentCount } : prev));
      announce({ ...base, commentCount }, revision, { counted: true });
    },
    [detailRef, confirmedCard, setDetail, announce],
  );

  // ── Writes that bump the version, one at a time ──

  /*
    Content edits, joining and leaving all change the task's version, and an
    edit is sent against the version it started from. Running them one after
    another means each is sent against the version the one before it left,
    instead of two in flight at once colliding with each other.
  */
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const enqueue = React.useCallback((job: () => Promise<void>) => {
    const run = queue.current.then(job);
    queue.current = run.catch(() => {});
  }, []);

  const flashSaved = React.useCallback(() => {
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  }, []);

  /**
    Save `patch`, where `originals` are what those fields held when the
    person started changing them. planSave() decides what is actually sent;
    a field a teammate changed in the meantime is not sent but handed back
    in the conflict banner. A CONFLICT from the server (the version moved
    under us) is planned again against the task it returns, so a change to
    some other field just goes through.
  */
  const saveContent = React.useCallback(
    (patch: ContentPatch, originals: ContentPatch) => {
      // Archived by someone else while this was being typed: the banner says
      // so, and sending it would only be refused.
      if (!hasFields(patch) || removed.current || confirmedCard()?.archivedAt) return;
      setPending((p) => ({ ...p, ...patch }));
      enqueue(async () => {
        let latest = confirmedCard();
        let reported: ScalarPatch = {};
        for (let attempt = 0; latest && attempt < 3 && !removed.current; attempt++) {
          const plan = planSave(omitFields(patch, reported), originals, contentOf(latest));
          if (hasFields(plan.conflicted)) {
            setConflict((c) => addConflict(c, plan.conflicted));
            reported = { ...reported, ...plan.conflicted };
          }
          if (!hasFields(plan.send)) break;
          const result = await track(runAction(updateTaskAction({ id: taskId, version: latest.version, ...plan.send })));
          if (result.ok) {
            applyResult(result.data, result.revision);
            if (plan.send.description !== undefined) flashSaved();
            // A field just saved has settled any clash it was in: leaving the
            // banner up would say "yours wasn't saved" about the value that
            // just was, and "Use mine" would then save the older one over it.
            for (const field of SCALAR_FIELDS) {
              if (plan.send[field] !== undefined) setConflict((c) => dropConflictField(c, field));
            }
            break;
          }
          if (result.code === "CONFLICT" && result.current) {
            const current = result.current;
            setDetail((d) => mergeDetail(d, current));
            latest = cardOf(current);
            continue;
          }
          if (result.code === "NOT_FOUND") handleGone(true);
          break;
        }
        setPending((p) => settlePending(p, patch));
      });
    },
    [setPending, enqueue, confirmedCard, track, taskId, applyResult, flashSaved, setDetail, handleGone],
  );

  /** What the person sees right now, including changes not answered yet. */
  const shownNow = React.useCallback((): TaskCard | null => {
    const base = confirmedCard();
    return base ? showCard(base, pendingRef.current) : null;
  }, [confirmedCard, pendingRef]);

  function changeField<K extends keyof ContentPatch>(field: K, value: ContentPatch[K]) {
    const current = shownNow();
    if (!current) return;
    saveContent({ [field]: value } as ContentPatch, { [field]: current[field] } as ContentPatch);
  }

  function joinOrLeave(kind: "join" | "leave") {
    const current = shownNow();
    if (!current || removed.current) return;
    const others = current.assigneeIds.filter((id) => id !== currentUserId);
    const patch: ContentPatch = { assigneeIds: kind === "join" ? [...others, currentUserId] : others };
    setPending((p) => ({ ...p, ...patch }));
    enqueue(async () => {
      if (removed.current) return;
      const result = await track(runAction(kind === "join" ? joinTaskAction(taskId) : leaveTaskAction(taskId)));
      if (result.ok) {
        applyResult(result.data, result.revision);
        toast.success(kind === "join" ? "You're on this task." : "You've left this task.");
      } else if (result.code === "NOT_FOUND") {
        handleGone(true);
      }
      setPending((p) => settlePending(p, patch));
    });
  }

  function reapplyMine(field: ScalarField) {
    const mine = conflict?.fields[field];
    const latest = confirmedCard();
    setConflict((c) => dropConflictField(c, field));
    if (mine === undefined || !latest) return;
    // Against the value now saved, so it goes through as a deliberate change rather than clashing again.
    saveContent({ [field]: mine } as ContentPatch, { [field]: latest[field] } as ContentPatch);
  }

  // ── Moving ──

  function changeStatus(to: Status) {
    const current = confirmedCard();
    if (!current || removed.current || (pendingStatus ?? current.status) === to) return;
    const seq = ++statusSeq.current;
    setPendingStatus(to);
    // Queued like the rest, so a move made straight after "I'll take this"
    // reaches the server after the pick-up it depends on.
    enqueue(async () => {
      const before = confirmedCard();
      if (!before || removed.current) {
        if (seq === statusSeq.current) setPendingStatus(null);
        return;
      }
      // Into the top of the column, as a move from a card's menu does.
      const { afterId, beforeId } = topOfColumn(boardRef.current.tasks, to, before.id);
      const result = await track(runAction(moveTaskAction({ id: taskId, status: to, afterId, beforeId })));
      if (seq === statusSeq.current) setPendingStatus(null);
      if (result.ok) {
        applyResult(result.data, result.revision);
        if (wasAutoAssigned(before.assigneeIds, result.data.assigneeIds, currentUserId)) {
          toast.success("Assigned to you", { description: `Moved to ${STATUS_LABEL[to]}.` });
        }
      } else if (result.code === "NOT_FOUND") {
        handleGone(true);
      }
    });
  }

  // ── Title and description ──

  const titleRef = React.useRef<HTMLTextAreaElement>(null);
  const [titleDraft, setTitleDraft, titleDraftRef] = useStateRef<string | null>(null);
  const titleOrigin = React.useRef("");
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null);
  const [descriptionDraft, setDescriptionDraft, descriptionDraftRef] = useStateRef<string | null>(null);
  const descriptionOrigin = React.useRef("");

  useAutoGrow(titleRef, titleDraft ?? card?.title ?? "");
  useAutoGrow(descriptionRef, descriptionDraft ?? card?.description ?? "");

  /*
    While a field is being edited its draft is drawn instead of the saved
    value, so a teammate's change arriving underneath never rewrites what is
    being typed. The value the field held when editing began is kept, and
    planSave() compares it with the latest to tell "I changed this" from
    "we both changed this".
  */
  function beginTitle() {
    const current = shownNow();
    if (titleDraftRef.current !== null || !current) return;
    titleOrigin.current = current.title;
    setTitleDraft(current.title);
  }

  function commitTitle() {
    const draft = titleDraftRef.current;
    if (draft === null) return;
    setTitleDraft(null);
    const clean = cleanTitle(draft);
    // An emptied title is put back rather than saved: every task needs one.
    if (!clean || clean === titleOrigin.current) return;
    saveContent({ title: clean }, { title: titleOrigin.current });
  }

  function beginDescription() {
    const current = shownNow();
    if (descriptionDraftRef.current !== null || !current) return;
    descriptionOrigin.current = current.description;
    setDescriptionDraft(current.description);
  }

  function commitDescription() {
    const draft = descriptionDraftRef.current;
    if (draft === null) return;
    setDescriptionDraft(null);
    // Trimmed as the server will store it, so an added trailing newline is not a change.
    const clean = draft.trim();
    if (clean === descriptionOrigin.current) return;
    saveContent({ description: clean }, { description: descriptionOrigin.current });
  }

  const flushDrafts = useLatest(() => {
    commitTitle();
    commitDescription();
  });
  React.useEffect(() => {
    beforeClose.current = () => flushDrafts.current();
    return () => {
      beforeClose.current = null;
    };
  }, [beforeClose, flushDrafts]);

  // ── Labels ──

  async function createLabel(name: string, color: ColorKey): Promise<LabelDTO | null> {
    const result = await runAction(createLabelAction({ name, color }));
    if (!result.ok) return null;
    setExtraLabels((l) => [...l, result.data]);
    onBoardStale();
    return result.data;
  }

  // ── Checklist ──

  function setChecklist(update: (items: ChecklistItemDTO[]) => ChecklistItemDTO[]) {
    setDetail((d) => (d ? { ...d, checklist: update(d.checklist) } : d));
  }

  async function addItem(text: string) {
    if (!detailRef.current || removed.current) return;
    const temp: ChecklistItemDTO = { id: tempId(++tempSeq.current), text, done: false, position: Number.MAX_SAFE_INTEGER };
    setChecklist((items) => applyChecklistChange(items, { kind: "add", item: temp }));
    const result = await track(runAction(addChecklistItemAction(taskId, text)));
    if (result.ok) {
      setChecklist((items) => applyChecklistChange(items, { kind: "replace", id: temp.id, item: result.data }));
      syncChecklist(result.revision);
    } else {
      setChecklist((items) => applyChecklistChange(items, { kind: "remove", id: temp.id }));
      if (result.code === "NOT_FOUND") handleGone(true);
    }
  }

  async function patchItem(id: string, patch: { text?: string; done?: boolean }) {
    const before = detailRef.current?.checklist.find((i) => i.id === id);
    if (!before || removed.current) return;
    setChecklist((items) => applyChecklistChange(items, { kind: "patch", id, patch }));
    const result = await track(runAction(updateChecklistItemAction(id, patch)));
    if (result.ok) {
      // What is on screen already says this, and may already say something newer.
      syncChecklist(result.revision);
      return;
    }
    setChecklist((items) => revertItem(items, id, patch, { text: before.text, done: before.done }));
    syncChecklist(null);
    // The item, or the whole task, has gone: read again to show what is really there.
    if (result.code === "NOT_FOUND") reload();
  }

  async function deleteItem(id: string) {
    const items = detailRef.current?.checklist ?? [];
    const index = items.findIndex((i) => i.id === id);
    if (index < 0 || removed.current) return;
    const item = items[index];
    setChecklist((list) => applyChecklistChange(list, { kind: "remove", id }));
    const result = await track(runAction(deleteChecklistItemAction(id)));
    if (result.ok) {
      syncChecklist(result.revision);
    } else if (result.code === "NOT_FOUND") {
      // Already gone, which is what was wanted.
      syncChecklist(null);
      reload();
    } else {
      setChecklist((list) => applyChecklistChange(list, { kind: "insert", item, index }));
      syncChecklist(null);
    }
  }

  // ── Comments ──

  async function addComment(body: string): Promise<boolean> {
    if (removed.current) return false;
    const result = await track(runAction(addCommentAction(taskId, body)));
    if (!result.ok) {
      if (result.code === "NOT_FOUND") handleGone(true);
      return false;
    }
    setDetail((d) => (d ? { ...d, comments: [...d.comments.filter((c) => c.id !== result.data.id), result.data] } : d));
    syncComments(result.revision);
    return true;
  }

  async function editComment(id: string, body: string): Promise<boolean> {
    const result = await track(runAction(editCommentAction(id, body)));
    if (result.ok) {
      setDetail((d) => (d ? { ...d, comments: d.comments.map((c) => (c.id === id ? result.data : c)) } : d));
      // The card is unchanged, but passing it on tells the board this revision was ours.
      const current = confirmedCard();
      if (current) announce(current, result.revision);
      return true;
    }
    if (result.code === "NOT_FOUND") {
      // Deleted while it was being edited; there is nothing left to edit.
      setDetail((d) => (d ? { ...d, comments: d.comments.filter((c) => c.id !== id) } : d));
      syncComments(lastRevision.current);
      return true;
    }
    return false;
  }

  async function deleteComment(id: string): Promise<boolean> {
    const result = await track(runAction(deleteCommentAction(id)));
    if (!result.ok && result.code !== "NOT_FOUND") return false;
    setDetail((d) => (d ? { ...d, comments: d.comments.filter((c) => c.id !== id) } : d));
    syncComments(result.ok ? result.revision : lastRevision.current);
    return true;
  }

  // ── Archive, restore, delete ──

  // Queued behind any save still going, so a title typed just before
  // pressing Archive is saved first rather than refused as "archived".
  function archive() {
    if (removed.current) return;
    setBusy("archive");
    enqueue(async () => {
      const result = await track(runAction(archiveTaskAction(taskId)));
      setBusy(null);
      if (result.ok) {
        toast.success("Task archived.", { description: "Find it under Done → Show archived." });
        dropTask(result.revision);
      } else if (result.code === "NOT_FOUND") {
        handleGone(true);
      }
    });
  }

  function restore() {
    setBusy("restore");
    enqueue(async () => {
      const result = await track(runAction(restoreTaskAction(taskId)));
      setBusy(null);
      if (result.ok) {
        applyResult(result.data, result.revision);
        toast.success("Task restored.", { description: `Back in ${STATUS_LABEL[result.data.status]}.` });
      } else if (result.code === "NOT_FOUND") {
        handleGone(true);
      }
    });
  }

  function deleteTask(): Promise<boolean> {
    return new Promise((resolve) => {
      enqueue(async () => {
        const result = await track(runAction(deleteTaskAction(taskId)));
        if (!result.ok && result.code !== "NOT_FOUND") {
          resolve(false);
          return;
        }
        // NOT_FOUND has already been toasted as "no longer exists" — gone either way.
        if (result.ok) toast.success("Task deleted.");
        resolve(true);
        dropTask(result.ok ? result.revision : lastRevision.current);
      });
    });
  }

  // ── Render ──

  if (!card) {
    return (
      <>
        <DialogTitle className="sr-only">Task</DialogTitle>
        {status === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm">Couldn&apos;t load this task.</p>
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-2" aria-busy="true" aria-label="Loading task">
            <div className="h-8 w-28 animate-pulse rounded-full bg-beige-deep" />
            <div className="h-7 w-3/4 animate-pulse rounded-lg bg-beige-deep" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-beige-deep" />
            <div className="h-24 animate-pulse rounded-2xl bg-beige-deep" />
          </div>
        )}
      </>
    );
  }

  const archived = card.archivedAt !== null;
  const canEdit = canEditTask(actor) && !archived;
  const canMove = canMoveTask(actor, card);
  const canJoin = canJoinTask(actor, card);
  const canLeave = canLeaveTask(actor, card);
  const canWork = canWorkChecklist(actor, card);
  const mayComment = canComment(actor, card);
  const canRemove = canArchiveOrDelete(actor);
  const loadingDetail = !detail && status === "loading";
  const { created, edited } = bylines(card, board.members, currentUserId, now);
  const descriptionSaving = pending.description !== undefined;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pr-10">
        <StatusSelect
          variant="pill"
          value={card.status}
          onChange={changeStatus}
          disabled={!canMove}
          label="Status"
        />
        {archived && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-2xs font-semibold text-muted-foreground">Archived</span>
        )}
        {!canMove && !archived && canJoin && (
          <span className="text-xs text-muted-foreground">Pick it up to move it.</span>
        )}
      </div>

      {archived && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted px-4 py-3 text-sm">
          <Archive className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1">This task is archived, so it can&apos;t be changed.</p>
          {canRemove && (
            <Button type="button" size="sm" variant="outline" onClick={restore} disabled={busy !== null}>
              <ArchiveRestore className="h-4 w-4" aria-hidden />
              {busy === "restore" ? "Restoring…" : "Restore"}
            </Button>
          )}
        </div>
      )}

      {conflict && (
        <div role="alert" className="rounded-2xl border border-warning/30 bg-warning-muted p-3 text-sm sm:p-4">
          <p className="flex items-start gap-2 font-semibold text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Someone else changed this task while you were editing.
          </p>
          <p className="mt-1 pl-6 text-foreground/80">Their version is showing. Yours wasn&apos;t saved:</p>
          <ul className="mt-3 space-y-2">
            {SCALAR_FIELDS.filter((f) => conflict.fields[f] !== undefined).map((field) => {
              const value = conflict.fields[field];
              const text =
                field === "priority"
                  ? PRIORITY_LABEL[value as keyof typeof PRIORITY_LABEL]
                  : field === "dueDate"
                    ? value
                      ? shortDay(value as string, today)
                      : "No due date"
                    : (value as string) || "(empty)";
              return (
                <li key={field} className="rounded-xl bg-card p-3">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Your {FIELD_NAME[field]}
                  </p>
                  <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]"><LinkifiedText text={text} /></p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => reapplyMine(field)} disabled={!canEdit}>
                      Use mine
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConflict((c) => dropConflictField(c, field))}
                    >
                      Keep theirs
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-1.5">
        {canEdit ? (
          <>
            <DialogTitle className="sr-only">{card.title}</DialogTitle>
            <textarea
              ref={titleRef}
              value={titleDraft ?? card.title}
              rows={1}
              maxLength={TITLE_MAX}
              aria-label="Title"
              spellCheck
              enterKeyHint="done"
              data-escape-cancels={titleDraft !== null ? true : undefined}
              onFocus={beginTitle}
              onChange={(e) => setTitleDraft(e.target.value.replace(/[\r\n]+/g, " "))}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTitle();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setTitleDraft(null);
                  e.currentTarget.blur();
                }
              }}
              onBlur={commitTitle}
              className={cn(
                "display -mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-xl border border-transparent bg-transparent px-2 py-1",
                "text-xl font-semibold leading-tight outline-none transition-colors sm:text-2xl",
                "hover:bg-accent/50 focus-visible:border-ring focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/30",
              )}
            />
          </>
        ) : (
          <DialogTitle className="text-xl [overflow-wrap:anywhere] sm:text-2xl">{card.title}</DialogTitle>
        )}
        <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{created}</span>
          {edited && (
            <>
              <span aria-hidden>·</span>
              <span>{edited}</span>
            </>
          )}
        </p>
      </div>

      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex min-h-7 items-center justify-between gap-2">
            <FieldLabel id={ids.assignees}>Assignees</FieldLabel>
            {canJoin && (
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-brand-ink" onClick={() => joinOrLeave("join")}>
                <Hand className="h-3.5 w-3.5" aria-hidden />
                I&apos;ll take this
              </Button>
            )}
            {canLeave && (
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5" onClick={() => joinOrLeave("leave")}>
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                Leave
              </Button>
            )}
          </div>
          <AssigneePicker
            labelId={ids.assignees}
            members={board.members}
            value={card.assigneeIds}
            onChange={(next) => changeField("assigneeIds", next)}
            readOnly={!canEdit}
            currentUserId={currentUserId}
          />
        </div>

        <div className="space-y-1">
          <div className="flex min-h-7 items-center">
            <FieldLabel id={ids.labels}>Labels</FieldLabel>
          </div>
          <LabelPicker
            labelId={ids.labels}
            labels={labels}
            value={card.labelIds}
            onChange={(next) => changeField("labelIds", next)}
            readOnly={!canEdit}
            onCreate={canEdit && canManageLabels(actor) ? createLabel : undefined}
          />
        </div>

        <div className="space-y-1">
          <div className="flex min-h-7 items-center">
            <FieldLabel htmlFor={canEdit ? ids.priority : undefined}>Priority</FieldLabel>
          </div>
          <PrioritySelect
            id={ids.priority}
            value={card.priority}
            onChange={(p) => changeField("priority", p)}
            readOnly={!canEdit}
          />
        </div>

        <div className="space-y-1">
          <div className="flex min-h-7 items-center">
            <FieldLabel htmlFor={canEdit ? ids.due : undefined}>Due date</FieldLabel>
          </div>
          <DueDateField
            id={ids.due}
            value={card.dueDate}
            onChange={(d) => changeField("dueDate", d)}
            readOnly={!canEdit}
            status={card.status}
            today={today}
          />
        </div>
      </div>

      <section className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={canEdit ? ids.description : undefined}>Description</FieldLabel>
          <span role="status" className="text-2xs font-medium text-muted-foreground">
            {descriptionSaving ? "Saving…" : saved ? <span className="text-success">Saved</span> : null}
          </span>
        </div>
        {canEdit ? (
          <textarea
            id={ids.description}
            ref={descriptionRef}
            value={descriptionDraft ?? card.description}
            rows={3}
            maxLength={DESCRIPTION_MAX}
            placeholder="Add more detail…"
            data-escape-cancels={descriptionDraft !== null ? true : undefined}
            onFocus={beginDescription}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitShortcut(e)) {
                e.preventDefault();
                commitDescription();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDescriptionDraft(null);
                e.currentTarget.blur();
              }
            }}
            onBlur={commitDescription}
            className={cn(
              "-mx-2 block min-h-[5.5rem] w-[calc(100%+1rem)] resize-none overflow-hidden rounded-xl border border-transparent bg-transparent px-2 py-1.5",
              "text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground",
              "hover:bg-accent/50 focus-visible:border-ring focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/30",
            )}
          />
        ) : card.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]"><LinkifiedText text={card.description} /></p>
        ) : (
          <p className="text-sm text-muted-foreground">No description.</p>
        )}
      </section>

      {!detail && status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted px-4 py-3 text-sm">
          <p className="min-w-0 flex-1">Couldn&apos;t load the checklist and comments.</p>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Try again
          </Button>
        </div>
      )}

      <Checklist
        items={detail?.checklist ?? []}
        // Not until the detail has loaded: adding needs it, and an item typed
        // into a box that cannot send would be cleared and silently lost.
        canWork={canWork && detail !== null}
        loading={loadingDetail}
        onAdd={(text) => void addItem(text)}
        onToggle={(id, done) => void patchItem(id, { done })}
        onRename={(id, text) => void patchItem(id, { text })}
        onDelete={(id) => void deleteItem(id)}
      />

      <Comments
        comments={detail?.comments ?? []}
        members={board.members}
        actor={actor}
        now={now}
        canComment={mayComment && detail !== null}
        loading={loadingDetail}
        onAdd={addComment}
        onEdit={editComment}
        onDelete={deleteComment}
      />

      <ActivityList
        activity={detail?.activity ?? []}
        members={board.members}
        currentUserId={currentUserId}
        now={now}
        loading={loadingDetail}
      />

      {canRemove && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {!archived && (
            <Button type="button" variant="outline" size="sm" onClick={archive} disabled={busy !== null}>
              <Archive className="h-4 w-4" aria-hidden />
              {busy === "archive" ? "Archiving…" : "Archive"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            disabled={busy !== null}
            className="text-destructive hover:bg-destructive-muted hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        description={
          <>
            <p>
              “{card.title}” and its checklist, comments and history will be gone for everyone. This can&apos;t be
              undone.
            </p>
            {!archived && <p>To keep it out of the way instead, archive it.</p>}
          </>
        }
        confirmLabel="Delete task"
        pendingLabel="Deleting…"
        destructive
        onConfirm={deleteTask}
      />
    </>
  );
}

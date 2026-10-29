"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import { useBackToClose } from "@/components/ui/back-to-close";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MAX_PHOTOS_PER_POST } from "@/modules/ideas/limits";
import type { IdeaPhoto } from "@/modules/ideas/types";
import { photoUrl, shrinkPhoto, uploadPhoto } from "./photo-upload";

/*
  Photos on ideas and replies, in the browser: picking them while writing
  (each one shrinks and uploads straight away, so posting is instant), and
  showing them on a post, with a full-screen viewer a tap away.
*/

// ── While writing ───────────────────────────────────────────────────────

type Draft = {
  key: string;
  /** Set once uploaded (or for a photo the post already had). */
  id: string | null;
  /** A local preview while it uploads; the served photo once it has an id. */
  src: string;
  width: number;
  height: number;
  status: "uploading" | "ready" | "failed";
  error?: string;
  file?: File;
};

export type PhotoDrafts = {
  drafts: Draft[];
  /** The uploaded ids, in order — what the post should carry. */
  ids: string[];
  uploading: boolean;
  failed: boolean;
  full: boolean;
  add: (files: FileList | File[]) => void;
  remove: (key: string) => void;
  retry: (key: string) => void;
  reset: () => void;
};

let seq = 0;

/** The photos being attached to one post, starting from the ones it already has. */
export function usePhotoDrafts(initial: IdeaPhoto[] = []): PhotoDrafts {
  const toDraft = (p: IdeaPhoto): Draft => ({
    key: `saved-${p.id}`,
    id: p.id,
    src: photoUrl(p.id),
    width: p.width,
    height: p.height,
    status: "ready",
  });
  const [drafts, setDrafts] = React.useState<Draft[]>(() => initial.map(toDraft));
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const patch = React.useCallback((key: string, change: Partial<Draft>) => {
    if (!alive.current) return;
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...change } : d)));
  }, []);

  const send = React.useCallback(
    async (key: string, file: File) => {
      patch(key, { status: "uploading", error: undefined });
      try {
        const shrunk = await shrinkPhoto(file);
        const uploaded = await uploadPhoto(shrunk);
        patch(key, { id: uploaded.id, width: uploaded.width, height: uploaded.height, status: "ready" });
      } catch (err) {
        patch(key, { status: "failed", error: err instanceof Error ? err.message : "Couldn't upload the photo." });
      }
    },
    [patch],
  );

  // A mirror of the list for event handlers, so picking photos never starts uploads inside a state update.
  const current = React.useRef(drafts);
  current.current = drafts;

  const add = React.useCallback(
    (files: FileList | File[]) => {
      const picked = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type === "");
      const room = Math.max(0, MAX_PHOTOS_PER_POST - current.current.length);
      const taken: Draft[] = picked.slice(0, room).map((file) => ({
        key: `new-${++seq}`,
        id: null,
        src: URL.createObjectURL(file),
        width: 4,
        height: 3,
        status: "uploading",
        file,
      }));
      if (taken.length === 0) return;
      current.current = [...current.current, ...taken];
      setDrafts((list) => [...list, ...taken]);
      taken.forEach((d) => void send(d.key, d.file!));
    },
    [send],
  );

  const remove = React.useCallback((key: string) => {
    setDrafts((list) => {
      const gone = list.find((d) => d.key === key);
      if (gone?.src.startsWith("blob:")) URL.revokeObjectURL(gone.src);
      return list.filter((d) => d.key !== key);
    });
  }, []);

  const retry = React.useCallback(
    (key: string) => {
      const draft = drafts.find((d) => d.key === key);
      if (draft?.file) void send(key, draft.file);
    },
    [drafts, send],
  );

  const reset = React.useCallback(() => {
    setDrafts((list) => {
      list.forEach((d) => d.src.startsWith("blob:") && URL.revokeObjectURL(d.src));
      return [];
    });
  }, []);

  return {
    drafts,
    ids: drafts.filter((d) => d.status === "ready" && d.id).map((d) => d.id!),
    uploading: drafts.some((d) => d.status === "uploading"),
    failed: drafts.some((d) => d.status === "failed"),
    full: drafts.length >= MAX_PHOTOS_PER_POST,
    add,
    remove,
    retry,
    reset,
  };
}

/** "Add photos": opens the camera roll (or the camera) on a phone, a file picker elsewhere. */
export function AddPhotosButton({ photos, disabled }: { photos: PhotoDrafts; disabled?: boolean }) {
  const input = React.useRef<HTMLInputElement>(null);
  const left = MAX_PHOTOS_PER_POST - photos.drafts.length;
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || photos.full}
        title={photos.full ? `Up to ${MAX_PHOTOS_PER_POST} photos` : "Add photos"}
        className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <ImagePlus className="h-4 w-4" aria-hidden />
        {photos.drafts.length === 0 ? "Add photos" : photos.full ? "4 photos max" : `Add ${left} more`}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) photos.add(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** The photos picked so far, small, each with a way to take it off again. */
export function PhotoDraftStrip({ photos, disabled }: { photos: PhotoDrafts; disabled?: boolean }) {
  if (photos.drafts.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      <ul className="flex flex-wrap gap-2" aria-label="Photos to attach">
        {photos.drafts.map((d, i) => (
          <li key={d.key} className="relative h-20 w-20 overflow-hidden rounded-xl border border-border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- local previews and private photos */}
            <img
              src={d.src}
              alt={`Photo ${i + 1}`}
              className={cn("h-full w-full object-cover", d.status !== "ready" && "opacity-60")}
            />
            {d.status === "uploading" && (
              <span className="absolute inset-0 flex items-center justify-center bg-background/30">
                <Loader2 className="h-5 w-5 animate-spin text-foreground" aria-label="Uploading" />
              </span>
            )}
            {d.status === "failed" && (
              <button
                type="button"
                onClick={() => photos.retry(d.key)}
                title={d.error ?? "Upload failed. Tap to retry."}
                className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-destructive/70 text-2xs font-semibold text-white"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => photos.remove(d.key)}
              disabled={disabled}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/70 text-background transition-colors hover:bg-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {photos.failed && (
        <p className="text-xs text-destructive">
          {photos.drafts.find((d) => d.status === "failed")?.error ?? "A photo didn't upload."} Tap it to retry, or remove it.
        </p>
      )}
    </div>
  );
}

// ── On a post ───────────────────────────────────────────────────────────

/**
  A post's photos: one shows wide (its own shape, within limits), two to four
  sit in a square grid. Tapping one opens the viewer.
*/
export function PhotoGallery({ photos, label, className }: { photos: IdeaPhoto[]; label: string; className?: string }) {
  const [open, setOpen] = React.useState<number | null>(null);
  if (photos.length === 0) return null;
  const single = photos.length === 1;
  return (
    <>
      <ul className={cn("grid gap-1.5", single ? "grid-cols-1" : "grid-cols-2", className)} aria-label={`Photos on ${label}`}>
        {photos.map((p, i) => {
          // A single photo keeps its own shape, but no taller than 5:4 portrait or flatter than 2:1.
          const ratio = Math.min(2, Math.max(0.8, p.width / p.height));
          return (
            <li key={p.id} className={cn(!single && photos.length === 3 && i === 0 && "col-span-2")}>
              <button
                type="button"
                onClick={() => setOpen(i)}
                className="block w-full overflow-hidden rounded-xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ aspectRatio: single ? String(ratio) : photos.length === 3 && i === 0 ? "2" : "1" }}
                aria-label={`Open photo ${i + 1} of ${photos.length}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- private photos behind sign-in */}
                <img src={photoUrl(p.id)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </button>
            </li>
          );
        })}
      </ul>
      <PhotoViewer photos={photos} index={open} onIndexChange={setOpen} />
    </>
  );
}

/** Full screen, one photo at a time: arrows or a sideways swipe for the others; Back or ✕ to close. */
function PhotoViewer({
  photos,
  index,
  onIndexChange,
}: {
  photos: IdeaPhoto[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
}) {
  const open = index !== null;
  const close = () => onIndexChange(null);
  useBackToClose(open, close);
  const touch = React.useRef<{ x: number; y: number } | null>(null);
  if (index === null) return <Dialog open={false} />;
  const photo = photos[index];
  const go = (step: number) => onIndexChange((index + step + photos.length) % photos.length);
  const many = photos.length > 1;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="h-[100dvh] max-h-none w-screen max-w-none gap-0 rounded-none border-0 bg-black/95 p-0 sm:h-[100dvh] sm:max-w-none sm:rounded-none [&>button]:hidden"
        onKeyDown={(e) => {
          if (!many) return;
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
      >
        <DialogTitle className="sr-only">{`Photo ${index + 1} of ${photos.length}`}</DialogTitle>
        <div
          className="relative flex h-full w-full items-center justify-center"
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t) touch.current = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const start = touch.current;
            const t = e.changedTouches[0];
            touch.current = null;
            if (!start || !t || !many) return;
            const dx = t.clientX - start.x;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(t.clientY - start.y)) go(dx < 0 ? 1 : -1);
          }}
        >
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- private photos behind sign-in
            <img
              key={photo.id}
              src={photoUrl(photo.id)}
              alt={`Photo ${index + 1} of ${photos.length}`}
              className="max-h-full max-w-full object-contain"
            />
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close photo"
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          {many && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25"
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
              <span className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium tabular-nums text-white">
                {index + 1} / {photos.length}
              </span>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

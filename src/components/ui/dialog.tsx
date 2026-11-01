"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { prefersZoom, zoomIn, zoomOut } from "@/components/ui/zoom-transition";

/*
  Dialog = Radix's Root, plus the phone zoom (see zoom-transition.ts): the
  sheet grows out of what was tapped and shrinks back into it on close.

  Closing is held for the length of that flight — Radix is told the dialog
  is still open until the sheet has landed, then closes it with no exit
  animation of its own. Opening it again mid-flight cancels the close.

  Only a dialog given `zoomFrom` zooms — the task sheet, out of its card
  (looked up afresh on close, since the card may have moved column). Every
  other dialog keeps the plain fade.
*/
const ZoomContext = React.createContext<((el: HTMLElement | null) => void) | null>(null);

type DialogProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root> & {
  zoomFrom?: () => Element | null;
};

function Dialog({ open, zoomFrom, children, ...props }: DialogProps) {
  const [shown, setShown] = React.useState(!!open);
  if (open && !shown) setShown(true);

  const contentRef = React.useRef<HTMLElement | null>(null);
  const zoomedRef = React.useRef<HTMLElement | null>(null);
  const zoomFromRef = React.useRef(zoomFrom);
  zoomFromRef.current = zoomFrom;
  // The card stays hidden under the sheet while it is open, as on iOS, so
  // the sheet reads as the card itself, lifted.
  const hiddenRef = React.useRef<HTMLElement | null>(null);

  const unhide = React.useCallback(() => {
    if (hiddenRef.current) hiddenRef.current.style.visibility = "";
    hiddenRef.current = null;
  }, []);

  React.useEffect(() => unhide, [unhide]);

  const setContent = React.useCallback((el: HTMLElement | null) => {
    contentRef.current = el;
    // A ref re-attaching to the same sheet is not a new opening.
    if (!el || el === zoomedRef.current) return;
    zoomedRef.current = el;
    if (!zoomFromRef.current || !prefersZoom()) return;
    const source = zoomFromRef.current();
    if (zoomIn(el, source) && source instanceof HTMLElement) {
      source.style.visibility = "hidden";
      hiddenRef.current = source;
    }
  }, []);

  React.useLayoutEffect(() => {
    if (open || !shown) return;
    const el = contentRef.current;
    unhide();
    const flight = el && zoomFromRef.current && prefersZoom() ? zoomOut(el, zoomFromRef.current(), () => setShown(false)) : null;
    if (!flight) {
      setShown(false);
      return;
    }
    // Reopened mid-flight: the sheet goes back to how it was. (Once landed
    // it unmounts in the same tick, so there is nothing left to undo.)
    return () => {
      if (contentRef.current === el) flight.cancel();
    };
  }, [open, shown, unhide]);

  return (
    <ZoomContext.Provider value={setContent}>
      <DialogPrimitive.Root open={open === undefined ? undefined : shown} {...props}>
        {children}
      </DialogPrimitive.Root>
    </ZoomContext.Provider>
  );
}
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] [animation-timing-function:cubic-bezier(0.23,1,0.32,1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/*
  Full-height sheet on phones, centred card from `sm` up. A task can carry a
  long description, a checklist and a comment thread, so the content scrolls
  inside the dialog rather than the page scrolling behind it.
*/
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose, ...props }, ref) => {
  const setZoomContent = React.useContext(ZoomContext);
  const setRefs = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
      setZoomContent?.(el);
    },
    [ref, setZoomContent],
  );
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setRefs}
        className={cn(
          "fixed inset-x-0 bottom-0 top-0 z-50 flex flex-col gap-4 overflow-y-auto border border-border bg-card p-5 shadow-float outline-none",
          "sm:inset-auto sm:left-1/2 sm:top-[8vh] sm:max-h-[84vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:rounded-bento sm:p-6",
          "[animation-timing-function:cubic-bezier(0.23,1,0.32,1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150",
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 pr-8 text-left", className)} {...props} />
);
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
);

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("display text-xl font-semibold leading-tight", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogClose };

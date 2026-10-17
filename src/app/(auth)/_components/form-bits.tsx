"use client";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, type InputProps } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/*
  The pieces the sign-in, setup and change-password forms share. Inputs are
  16px on phones: anything smaller and iOS zooms the page on focus.
*/

export const authInputClass = "h-12 rounded-2xl px-4 text-base sm:text-sm";

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-2xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A password box with a show/hide toggle — typing a long password blind on a phone is how typos get in. */
export function PasswordInput({ className, ...props }: Omit<InputProps, "type">) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn(authInputClass, "pr-12", className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={props.id}
        className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-2xl bg-destructive-muted px-3.5 py-2.5 text-sm text-destructive">
      {message}
    </p>
  );
}

export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

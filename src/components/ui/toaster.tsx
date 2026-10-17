"use client";
import { Toaster as Sonner } from "sonner";
import { useTheme } from "next-themes";

export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: "!rounded-2xl !border-border !bg-popover !text-popover-foreground !shadow-lift",
          description: "!text-muted-foreground",
        },
      }}
    />
  );
}

export { toast } from "sonner";

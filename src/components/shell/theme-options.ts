import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

/** The three appearance choices, shared by the user menu and Settings. */
export const THEME_OPTIONS: { value: "light" | "dark" | "system"; label: string; hint: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", hint: "Cream and espresso", icon: Sun },
  { value: "dark", label: "Dark", hint: "Easier at night", icon: Moon },
  { value: "system", label: "System", hint: "Follow this device", icon: Monitor },
];

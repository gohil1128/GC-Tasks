import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/*
  The God's Chai mark is espresso and rust on a transparent ground, so on the
  dark theme the espresso half would vanish into the background. There it sits
  on a small cream plate instead: the logo's own colours, not a recoloured copy.

  `className` places it (margins, alignment); `imgClassName` sizes it with a
  height (h-8, h-14…) and the width follows.
*/
export function BrandLogo({
  className,
  imgClassName,
  decorative = false,
}: {
  className?: string;
  imgClassName?: string;
  decorative?: boolean;
}) {
  return (
    <span className={cn("inline-flex shrink-0 dark:rounded-lg dark:bg-[hsl(var(--rust-100))] dark:p-1", className)}>
      {/* A plain img: a 300px PNG gains nothing from the image optimiser. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt={decorative ? "" : APP_NAME} className={cn("h-8 w-auto", imgClassName)} />
    </span>
  );
}

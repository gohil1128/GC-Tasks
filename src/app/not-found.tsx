import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/shell/brand-logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-md text-center">
        <BrandLogo className="mb-8" imgClassName="h-14" />
        <p className="display text-[64px] font-semibold leading-none text-brand-ink">404</p>
        <h1 className="mt-4 text-xl font-semibold">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be out of date, or what it pointed to has been removed.
        </p>
        <div className="mt-7 flex justify-center">
          <Button asChild>
            <Link href="/">Back to the board</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

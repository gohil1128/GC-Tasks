import { BrandLogo } from "@/components/shell/brand-logo";

/*
  The frame for the short, one-purpose pages — setup and change password. The
  sign-in page keeps its own two-panel brand layout; these are a single form
  each and a centred column suits them better than half a screen of espresso.
*/
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <main className="w-full max-w-[400px]">
        <BrandLogo className="mb-6" imgClassName="h-14" />
        <h1 className="display text-[28px] font-semibold leading-tight">{title}</h1>
        {description && <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</div>}
        <div className="mt-7">{children}</div>
        {footer && <div className="mt-6 text-center text-xs text-muted-foreground">{footer}</div>}
      </main>
    </div>
  );
}

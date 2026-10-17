/** One card on the Settings page. */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-bento border border-border bg-card p-5 shadow-card sm:p-6">
      <h2 id={`${id}-heading`} className="display text-xl font-semibold">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

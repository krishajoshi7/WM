import type { ReactNode } from "react";

export function MetricCard({
  label,
  value,
  helper,
  icon
}: {
  label: string;
  value: ReactNode;
  helper?: string;
  icon?: ReactNode;
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-operational">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-muted-foreground">{label}</span>
        {icon ? <span className="text-primary">{icon}</span> : null}
      </div>
      <strong className="mt-3 block text-3xl font-black tracking-normal">{value}</strong>
      {helper ? <p className="mt-1 text-sm text-muted-foreground">{helper}</p> : null}
    </article>
  );
}

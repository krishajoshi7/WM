import { cn, statusLabel } from "@/lib/utils";
import type { BatchStatus } from "@/lib/types";

const colors: Record<BatchStatus, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  assigned: "bg-sky-100 text-sky-800 border-sky-200",
  picked_up: "bg-amber-100 text-amber-900 border-amber-200",
  in_transit: "bg-indigo-100 text-indigo-800 border-indigo-200",
  delivered: "bg-emerald-100 text-emerald-800 border-emerald-200",
  recycled: "bg-green-100 text-green-800 border-green-200"
};

export function StatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-bold", colors[status])}>
      {statusLabel(status)}
    </span>
  );
}

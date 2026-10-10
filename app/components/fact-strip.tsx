import { Link } from "react-router"
import { HelpTip } from "#/components/help-tip"
import { cn } from "#/lib/utils"

/**
 * The state of a licence or an app at a glance: a row of facts separated by hairlines. Facts that need action use the
 * "warning" or "danger" tone.
 */
export function FactStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</dl>
}

const TONE = {
  default: "",
  success: "text-green-700 dark:text-green-400",
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-red-700 dark:text-red-400",
}

/** One fact. With `to`, the whole cell links to the list behind the number. */
export function Fact({ label, help, value, detail, tone = "default", to }: { label: string; help?: React.ReactNode; value: React.ReactNode; detail?: React.ReactNode; tone?: keyof typeof TONE; to?: string }) {
  return (
    <div className={cn("relative min-w-0 bg-card px-4 py-3", to && "transition-colors focus-within:bg-muted/60 hover:bg-muted/60")}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {/* A stretched link: it covers the cell, while the help button stays above it. */}
        {to ? (
          <Link to={to} className="after:absolute after:inset-0 focus-visible:outline-none">
            {label}
          </Link>
        ) : (
          label
        )}
        {help && (
          <span className="relative z-10 inline-flex">
            <HelpTip>{help}</HelpTip>
          </span>
        )}
      </dt>
      <dd className={cn("mt-1 truncate text-lg font-semibold tabular-nums", TONE[tone])}>{value}</dd>
      {detail && <dd className="truncate text-xs text-muted-foreground">{detail}</dd>}
    </div>
  )
}

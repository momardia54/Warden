import { format, formatDistanceToNow } from "date-fns"

/** "3 minutes ago" or "in 5 minutes". The text depends on the clock, so hydration is allowed to differ. */
export function Ago({ ts, empty = "never" }: { ts: number | null | undefined; empty?: string }) {
  if (!ts) return <span className="text-muted-foreground">{empty}</span>
  return (
    <time dateTime={new Date(ts).toISOString()} title={format(ts, "PPpp")} suppressHydrationWarning>
      {formatDistanceToNow(ts, { addSuffix: true })}
    </time>
  )
}

export function When({ ts }: { ts: number }) {
  return (
    <time dateTime={new Date(ts).toISOString()} suppressHydrationWarning>
      {format(ts, "PPpp")}
    </time>
  )
}

import { TrendingDown, TrendingUp } from "lucide-react"

export function StatCard({
  title,
  value,
  trend,
  hint,
}: {
  title: string
  value: string | number
  trend?: number
  hint?: string
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="mt-1 flex items-end gap-2">
        <p className="text-2xl font-bold">{value}</p>
        {trend !== undefined && (
          <div
            className={`flex items-center gap-1 pb-0.5 text-xs font-medium ${
              trend > 0 ? "text-green-600 dark:text-green-500" : trend < 0 ? "text-red-600 dark:text-red-500" : "text-muted-foreground"
            }`}
          >
            {trend < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
            <span>
              {trend > 0 ? "+" : ""}
              {trend}%
            </span>
          </div>
        )}
        {hint && <span className="pb-0.5 text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  )
}

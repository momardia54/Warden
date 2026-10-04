import { Info } from "lucide-react"
import { Label } from "#/components/ui/label"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip"

/** An info icon that explains a field or a value on hover or focus. */
export function HelpTip({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="inline-flex text-muted-foreground hover:text-foreground focus-visible:text-foreground" aria-label="More information">
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-left leading-snug">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** A form label with an optional help tooltip. */
export function FieldLabel({ htmlFor, children, help }: { htmlFor?: string; children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{children}</Label>
      {help && <HelpTip>{help}</HelpTip>}
    </div>
  )
}

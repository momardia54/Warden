import { useEffect, useState } from "react"
import { Link, useFetcher } from "react-router"
import { Ban, Copy, ShieldBan } from "lucide-react"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "#/components/ui/dropdown-menu"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { NativeSelect } from "#/components/ui/native-select"
import { BLOCK_DURATION_LABELS, BLOCK_DURATIONS } from "#/lib/ip"
import { cn } from "#/lib/utils"

/** The action that adds blocks; the dialog posts to it from any page. */
export const BLOCK_ACTION = "/protection"

/** Adds an address or range to the blocklist. Opened from an address menu or from the Blocked IPs page. */
export function BlockIpDialog({ open, onOpenChange, initialValue = "" }: { open: boolean; onOpenChange: (open: boolean) => void; initialValue?: string }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>()
  const busy = fetcher.state !== "idle"
  const [value, setValue] = useState(initialValue)
  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onOpenChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block an IP address</DialogTitle>
          <DialogDescription>Checks and downloads from this address are refused with 403 before any licence is read. The dashboard and the API are not affected.</DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" action={BLOCK_ACTION} className="space-y-4">
          <input type="hidden" name="intent" value="block" />
          <div className="space-y-1.5">
            <Label htmlFor="block-value">IP address or range</Label>
            <Input id="block-value" name="value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="203.0.113.5 or 203.0.113.0/24" className="font-mono" required autoComplete="off" />
            <p className="text-xs text-muted-foreground">
              A range blocks every address in it. Several sites on one shared host can use the same address: blocking it blocks them all.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="block-days">Duration</Label>
              <NativeSelect id="block-days" name="days" defaultValue="7">
                {BLOCK_DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {BLOCK_DURATION_LABELS[d]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="block-reason">Reason (internal)</Label>
              <Input id="block-reason" name="reason" maxLength={200} placeholder="For example: checks with stolen keys" autoComplete="off" />
            </div>
          </div>
          {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={busy}>
              <Ban /> Block
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  )
}

/** An address with a menu: copy it, or block it. `blocked` marks an address already covered by a block. */
export function IpAddress({ ip, blocked = false, className }: { ip: string | null; blocked?: boolean; className?: string }) {
  const [blocking, setBlocking] = useState(false)
  if (!ip) return <span className={cn("text-xs text-muted-foreground", className)}>No address</span>
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn("-mx-1 inline-flex items-center gap-1.5 rounded px-1 font-mono text-xs whitespace-nowrap hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring", className)} title={`Actions for ${ip}`}>
          <span>{ip}</span>
          {blocked && <Badge variant="destructive">Blocked</Badge>}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="truncate font-mono text-xs font-normal text-muted-foreground">{ip}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => navigator.clipboard?.writeText(ip)}>
            <Copy /> Copy address
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {blocked ? (
            <DropdownMenuItem asChild>
              <Link to="/protection">
                <ShieldBan /> View in blocklist
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onClick={() => setBlocking(true)}>
              <Ban /> Block this IP…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <BlockIpDialog open={blocking} onOpenChange={setBlocking} initialValue={ip} />
    </>
  )
}

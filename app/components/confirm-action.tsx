import { useState } from "react"
import { Form, useNavigation } from "react-router"
import { Button } from "#/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "#/components/ui/dialog"

/** A button that opens a confirmation dialog and, on confirmation, posts `intent` to the current route. */
export function ConfirmAction({ intent, trigger, title, description, confirm }: { intent: string; trigger: React.ReactNode; title: string; description: string; confirm: string }) {
  const [open, setOpen] = useState(false)
  const busy = useNavigation().state === "submitting"
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Form method="post" onSubmit={() => setOpen(false)}>
          <input type="hidden" name="intent" value={intent} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={busy}>
              {confirm}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}


import { useState } from "react"
import { Form, useNavigation } from "react-router"
import { Button } from "#/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "#/components/ui/dialog"

type Props = {
  intent: string
  title: string
  description: string
  confirm: string
  /** The button that opens the dialog. Omit it and pass `open` and `onOpenChange` to open the dialog from a menu. */
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** A confirmation dialog that, on confirmation, posts `intent` to the current route. */
export function ConfirmAction({ intent, trigger, title, description, confirm, open: controlled, onOpenChange }: Props) {
  const [own, setOwn] = useState(false)
  const open = controlled ?? own
  const setOpen = onOpenChange ?? setOwn
  const busy = useNavigation().state === "submitting"
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
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

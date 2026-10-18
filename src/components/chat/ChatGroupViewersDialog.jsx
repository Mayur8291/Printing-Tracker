import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

function ViewerList({ title, rows }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium">
        {title} ({rows.length})
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.userId} className="text-sm">
              {row.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ChatGroupViewersDialog({ open, onOpenChange, seen = [], unseen = [] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Viewers</DialogTitle>
          <DialogDescription>Who has opened this group post, and who has not.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-72">
          <div className="flex flex-col gap-4 pr-3">
            <ViewerList title="Seen" rows={seen} />
            <Separator />
            <ViewerList title="Not seen" rows={unseen} />
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

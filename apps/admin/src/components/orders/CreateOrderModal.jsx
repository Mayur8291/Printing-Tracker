import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

export default function CreateOrderModal({ open, onOpenChange, title, children }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(1100px,98vw)] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]">
        <DialogHeader className="shrink-0 space-y-0 border-b px-6 py-4 pr-12 text-left">
          <DialogTitle className="text-xl">{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

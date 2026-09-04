import { useMemo, useState } from "react";
import { Forward } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { conversationDisplayTitle } from "@/teamChatUtils";

export function ChatForwardDialog({
  open,
  onOpenChange,
  conversations,
  currentConversationId,
  sessionUserId,
  teamProfiles,
  onForward,
  sending = false,
  canPostToChannel = false
}) {
  const [targetId, setTargetId] = useState(null);

  const options = useMemo(
    () =>
      (conversations ?? []).filter((conv) => {
        if (!conv.id || conv.id === currentConversationId) return false;
        if (conv.kind === "channel" && !canPostToChannel) return false;
        return true;
      }),
    [conversations, currentConversationId, canPostToChannel]
  );

  async function confirm() {
    if (!targetId || sending) return;
    await onForward(targetId);
    setTargetId(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTargetId(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">Forward</DialogTitle>
          <DialogDescription className="sr-only">Pick a chat or group.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-64 rounded-md border">
          <ul className="flex flex-col">
            {options.length === 0 ? (
              <li className="p-4 text-center text-sm text-muted-foreground">No other chats.</li>
            ) : (
              options.map((conv) => (
                <li key={conv.id}>
                  <Button
                    type="button"
                    variant={targetId === conv.id ? "secondary" : "ghost"}
                    className="h-auto w-full justify-start rounded-none px-3 py-2.5"
                    onClick={() => setTargetId(conv.id)}
                  >
                    <span className="truncate">
                      {conversationDisplayTitle(conv, sessionUserId, teamProfiles)}
                    </span>
                  </Button>
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
        <div className="flex justify-end">
          <Button
            type="button"
            size="icon"
            disabled={!targetId || sending}
            aria-label="Forward"
            onClick={() => void confirm()}
          >
            <Forward />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

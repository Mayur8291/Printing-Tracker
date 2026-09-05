import { Copy, Forward, Info, Pin, Reply, SmilePlus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CHAT_EMOJI_PALETTE } from "@/teamChatUtils";

function IconAction({ label, onClick, disabled, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ChatMessageActionBar({
  count,
  canDelete,
  pinned,
  reactOpen,
  onReactOpenChange,
  onReply,
  onReact,
  onDelete,
  onForward,
  onPin,
  onCopy,
  onClear,
  channelReadOnly = false,
  showViewers = false,
  onViewers
}) {
  const multi = count > 1;
  const showAuthorActions = !multi && !channelReadOnly;

  return (
    <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {showAuthorActions ? (
        <IconAction label="Reply" onClick={onReply}>
          <Reply />
        </IconAction>
      ) : null}
      {multi ? null : (
        <>
          <Popover open={reactOpen} onOpenChange={onReactOpenChange}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="React">
                    <SmilePlus />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>React</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-64 p-2" align="end">
              <div className="grid grid-cols-8 gap-1" role="listbox" aria-label="React">
                {CHAT_EMOJI_PALETTE.map((emoji) => (
                  <Button
                    key={emoji}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-base"
                    aria-label={emoji}
                    onClick={() => onReact(emoji)}
                  >
                    {emoji}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {showAuthorActions ? (
            <IconAction label="Pin" onClick={onPin}>
              <Pin className={pinned ? "fill-current" : undefined} />
            </IconAction>
          ) : null}
        </>
      )}
      {showViewers ? (
        <IconAction label="Viewers" onClick={onViewers}>
          <Info />
        </IconAction>
      ) : null}
      <IconAction label="Copy" onClick={onCopy}>
        <Copy />
      </IconAction>
      <IconAction label="Forward" onClick={onForward}>
        <Forward />
      </IconAction>
      {channelReadOnly || !canDelete ? null : (
        <IconAction label="Delete" onClick={onDelete}>
          <Trash2 />
        </IconAction>
      )}
      <IconAction label="Clear" onClick={onClear}>
        <X />
      </IconAction>
    </div>
  );
}

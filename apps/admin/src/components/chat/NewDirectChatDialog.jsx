import { useMemo, useState } from "react";
import { MessageCirclePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { profileAvatarPublicUrl } from "@/avatarUtils";
import { profileChatLabel } from "@/teamChatUtils";

export function NewDirectChatDialog({ sessionUserId, teamProfiles, onStartChat, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (teamProfiles ?? [])
      .filter((p) => p.id && p.id !== sessionUserId)
      .filter((p) => {
        if (!q) return true;
        const label = profileChatLabel(p).toLowerCase();
        const dept = (p.department ?? "").toLowerCase();
        return label.includes(q) || dept.includes(q);
      })
      .sort((a, b) => profileChatLabel(a).localeCompare(profileChatLabel(b)));
  }, [teamProfiles, sessionUserId, query]);

  async function pickUser(profile) {
    setStarting(true);
    try {
      await onStartChat(profile.id);
      setOpen(false);
      setQuery("");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="gap-1.5">
          <MessageCirclePlus className="size-4" />
          New chat
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start direct chat</DialogTitle>
          <DialogDescription>Pick anyone on the team to message privately.</DialogDescription>
        </DialogHeader>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or department…"
          autoFocus
        />

        <ScrollArea className="h-64 rounded-md border">
          <ul className="divide-y">
            {filtered.length === 0 ? (
              <li className="p-4 text-center text-sm text-muted-foreground">No matching users</li>
            ) : (
              filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent disabled:opacity-50"
                    disabled={starting}
                    onClick={() => pickUser(p)}
                  >
                    <PersonAvatar
                      name={p.full_name || profileChatLabel(p)}
                      email={p.email}
                      imageUrl={profileAvatarPublicUrl(p.avatar_path)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{profileChatLabel(p)}</span>
                      {p.department?.trim() ? (
                        <span className="block truncate text-xs text-muted-foreground">{p.department.trim()}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

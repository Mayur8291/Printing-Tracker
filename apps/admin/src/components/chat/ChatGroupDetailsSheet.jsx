import { useMemo, useRef, useState } from "react";
import { Camera, UserPlus } from "lucide-react";
import { groupAvatarPublicUrl, profileAvatarPublicUrl, validateAvatarPhotoFile } from "@/avatarUtils";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { conversationDisplayTitle, profileChatLabel } from "@/teamChatUtils";
import {
  addGroupConversationMembers,
  removeGroupConversationMember,
  setGroupConversationMemberAdmin,
  uploadGroupConversationAvatar
} from "@/teamChatService";

export function ChatGroupDetailsSheet({
  open,
  onOpenChange,
  conversation,
  sessionUserId,
  teamProfiles,
  composePeer = null,
  isGroupAdmin = false,
  onChanged
}) {
  const photoRef = useRef(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [removeTarget, setRemoveTarget] = useState(null);
  const [promoteTarget, setPromoteTarget] = useState(null);

  const isGroup = conversation?.kind === "group";
  const title = composePeer
    ? profileChatLabel(composePeer)
    : conversationDisplayTitle(conversation, sessionUserId, teamProfiles);
  const peer =
    composePeer ??
    (conversation?.kind === "direct"
      ? (teamProfiles ?? []).find(
          (p) =>
            p.id &&
            String(p.id) !== String(sessionUserId) &&
            (conversation.member_ids ?? []).some((id) => String(id) === String(p.id))
        )
      : null);
  const heroUrl = isGroup
    ? groupAvatarPublicUrl(conversation?.avatar_path)
    : profileAvatarPublicUrl(peer?.avatar_path);
  const memberIds = new Set((conversation?.member_ids ?? []).map(String));
  const adminCount = (conversation?.member_reads ?? []).filter((row) => row.role === "admin").length;

  const members = useMemo(() => {
    if (isGroup) {
      return (conversation?.member_reads ?? [])
        .map((row) => {
          const profile = (teamProfiles ?? []).find((p) => String(p.id) === String(row.user_id));
          return {
            userId: row.user_id,
            role: row.role === "admin" ? "admin" : "member",
            label: profileChatLabel(profile),
            profile
          };
        })
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
          return a.label.localeCompare(b.label);
        });
    }

    const ids = (conversation?.member_ids ?? []).length
      ? conversation.member_ids
      : [sessionUserId, composePeer?.id].filter(Boolean);
    return ids.map((userId) => {
      const profile = (teamProfiles ?? []).find((p) => String(p.id) === String(userId));
      return {
        userId,
        role: "member",
        label: profileChatLabel(profile),
        profile
      };
    });
  }, [isGroup, conversation, teamProfiles, sessionUserId, composePeer]);

  const addCandidates = useMemo(
    () =>
      (teamProfiles ?? [])
        .filter((p) => p.id && !memberIds.has(String(p.id)))
        .sort((a, b) => profileChatLabel(a).localeCompare(profileChatLabel(b))),
    [teamProfiles, memberIds]
  );

  function toggleAdd(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !conversation?.id) return;
    const validationError = validateAvatarPhotoFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    await run(() => uploadGroupConversationAvatar(conversation.id, file));
  }

  async function handleAddPeople() {
    if (!conversation?.id || selected.size === 0) return;
    await run(async () => {
      await addGroupConversationMembers(conversation.id, [...selected]);
      setSelected(new Set());
      setAddOpen(false);
    });
  }

  async function handlePromote() {
    if (!conversation?.id || !promoteTarget) return;
    await run(async () => {
      await setGroupConversationMemberAdmin(conversation.id, promoteTarget.userId);
      setPromoteTarget(null);
    });
  }

  async function handleRemove() {
    if (!conversation?.id || !removeTarget) return;
    await run(async () => {
      await removeGroupConversationMember(conversation.id, removeTarget.userId);
      setRemoveTarget(null);
    });
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex flex-col gap-4 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>
              {isGroup
                ? `${members.length} ${members.length === 1 ? "member" : "members"}`
                : "Chat"}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col items-center gap-3">
            <PersonAvatar name={title} imageUrl={heroUrl} size="xl" />
            {isGroupAdmin ? (
              <>
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => void handlePhoto(e)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => photoRef.current?.click()}
                >
                  <Camera />
                  Change photo
                </Button>
              </>
            ) : null}
          </div>

          {isGroupAdmin ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => setAddOpen(true)}>
              <UserPlus />
              Add people
            </Button>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Members</h3>
            <ul className="flex flex-col gap-3">
              {members.map((row) => {
                const isSelf = String(row.userId) === String(sessionUserId);
                const canPromote = isGroupAdmin && row.role !== "admin";
                const canRemove =
                  isGroupAdmin &&
                  !isSelf &&
                  (row.role !== "admin" || adminCount > 1);
                const avatarUrl = profileAvatarPublicUrl(row.profile?.avatar_path);

                return (
                  <li key={row.userId} className="flex items-start gap-3">
                    <PersonAvatar
                      name={row.profile?.full_name || row.label}
                      email={row.profile?.email}
                      imageUrl={avatarUrl}
                      size="sm"
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{row.label}</span>
                        {isGroup && row.role === "admin" ? <Badge variant="secondary">Admin</Badge> : null}
                        {isSelf ? <span className="text-xs text-muted-foreground">You</span> : null}
                      </div>
                      {canPromote || canRemove ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {canPromote ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => setPromoteTarget(row)}
                            >
                              Make admin
                            </Button>
                          ) : null}
                          {canRemove ? (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={busy}
                              onClick={() => setRemoveTarget(row)}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          setAddOpen(next);
          if (!next) setSelected(new Set());
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add people</DialogTitle>
            <DialogDescription>Pick team members to add to this group.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-56 rounded-md border p-2">
            {addCandidates.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">Everyone is already in this group.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {addCandidates.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`add-member-${p.id}`}
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleAdd(p.id)}
                    />
                    <label htmlFor={`add-member-${p.id}`} className="cursor-pointer text-sm">
                      {profileChatLabel(p)}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleAddPeople()} disabled={busy || selected.size === 0}>
              {busy ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(promoteTarget)} onOpenChange={(next) => !next && setPromoteTarget(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Make admin</DialogTitle>
            <DialogDescription>
              {promoteTarget ? `${promoteTarget.label} can add people, change the photo, and remove members.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPromoteTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handlePromote()} disabled={busy}>
              Make admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removeTarget)} onOpenChange={(next) => !next && setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Remove from group</DialogTitle>
            <DialogDescription>
              {removeTarget ? `Remove ${removeTarget.label} from this group?` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setRemoveTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleRemove()} disabled={busy}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

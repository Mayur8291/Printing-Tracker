import { useMemo, useState } from "react";
import { UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { profileChatLabel } from "@/teamChatUtils";

export function CreateGroupDialog({ sessionUserId, teamProfiles, onCreate, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const candidates = useMemo(
    () =>
      (teamProfiles ?? [])
        .filter((p) => p.id && p.id !== sessionUserId)
        .sort((a, b) => profileChatLabel(a).localeCompare(profileChatLabel(b))),
    [teamProfiles, sessionUserId]
  );

  function toggleMember(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Group name required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const convId = await onCreate(cleanTitle, [...selected]);
      setOpen(false);
      setTitle("");
      setSelected(new Set());
      return convId;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="gap-1.5">
          <UsersRound className="size-4" />
          New group
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create group</DialogTitle>
          <DialogDescription>Add a name and pick team members. You are added automatically.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-title">Group name</Label>
            <Input
              id="group-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Production updates"
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label>Members</Label>
            <ScrollArea className="h-52 rounded-md border p-2">
              <ul className="space-y-2">
                {candidates.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`member-${p.id}`}
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleMember(p.id)}
                    />
                    <label htmlFor={`member-${p.id}`} className="cursor-pointer text-sm">
                      {profileChatLabel(p)}
                      {p.department?.trim() ? (
                        <span className="ml-1 text-xs text-muted-foreground">· {p.department.trim()}</span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

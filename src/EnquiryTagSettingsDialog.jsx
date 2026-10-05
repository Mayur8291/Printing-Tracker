import { useEffect, useMemo, useState } from "react";
import { Plus, Tag } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { profileDisplayName } from "./enquiryUtils";
import { createEnquiryTag, setEnquiryTagActive, setEnquiryTagMember } from "./enquiryTagUtils";
import { viewerIsActive } from "./viewerUserListUtils";

/**
 * Admin only. Left: tag list (add / enable). Right: tick users who hold the selected tag.
 * Tagged enquiries show for admins and for users ticked here.
 */
export default function EnquiryTagSettingsDialog({
  open,
  onOpenChange,
  tags,
  members,
  teamProfiles,
  sessionUserId,
  onChanged
}) {
  const [selectedTagId, setSelectedTagId] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");

  const sortedTags = useMemo(
    () => [...(tags ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)),
    [tags]
  );

  const users = useMemo(
    () =>
      [...(teamProfiles ?? [])]
        .filter((p) => viewerIsActive(p))
        .sort((a, b) => profileDisplayName(a).localeCompare(profileDisplayName(b))),
    [teamProfiles]
  );

  const memberCountByTag = useMemo(() => {
    const counts = {};
    for (const m of members ?? []) counts[m.tag_id] = (counts[m.tag_id] ?? 0) + 1;
    return counts;
  }, [members]);

  const selectedMemberIds = useMemo(() => {
    const set = new Set();
    for (const m of members ?? []) if (m.tag_id === selectedTagId) set.add(m.user_id);
    return set;
  }, [members, selectedTagId]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setNewTagName("");
    if (!selectedTagId || !sortedTags.some((t) => t.id === selectedTagId)) {
      setSelectedTagId(sortedTags[0]?.id ?? "");
    }
  }, [open, sortedTags, selectedTagId]);

  const selectedTag = sortedTags.find((t) => t.id === selectedTagId) ?? null;

  async function run(key, fn) {
    setBusyKey(key);
    setError("");
    try {
      await fn();
      await onChanged?.();
    } catch (e) {
      setError(e.message || "Could not save.");
    } finally {
      setBusyKey("");
    }
  }

  function handleAddTag() {
    const name = newTagName.trim();
    if (!name) {
      setError("Type a tag name first.");
      return;
    }
    const nextOrder = (sortedTags.at(-1)?.sort_order ?? 0) + 10;
    void run("add", async () => {
      const created = await createEnquiryTag({ name, createdBy: sessionUserId, sortOrder: nextOrder });
      setNewTagName("");
      setSelectedTagId(created.id);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="size-4" aria-hidden />
            Enquiry tags
          </DialogTitle>
          <DialogDescription>
            Tag an enquiry at create. Users ticked under a tag see those enquiries on their Support
            tab. Admin always sees everything.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <div className="flex flex-col gap-3">
            <Label>Tags</Label>
            <div className="flex flex-col gap-1 rounded-md border p-1">
              {sortedTags.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">No tags yet.</p>
              ) : (
                sortedTags.map((tag) => (
                  <Button
                    key={tag.id}
                    type="button"
                    variant={tag.id === selectedTagId ? "secondary" : "ghost"}
                    size="sm"
                    className={cn("justify-between", !tag.is_active && "text-muted-foreground")}
                    onClick={() => setSelectedTagId(tag.id)}
                  >
                    <span className="truncate">{tag.name}</span>
                    <Badge variant="outline" className="ml-2 rounded-full px-1.5 py-0 text-[10px]">
                      {memberCountByTag[tag.id] ?? 0}
                    </Badge>
                  </Button>
                ))
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-enquiry-tag">Add tag</Label>
              <div className="flex gap-2">
                <Input
                  id="new-enquiry-tag"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="e.g. Schools"
                />
                <Button type="button" size="icon" disabled={busyKey === "add"} onClick={handleAddTag} aria-label="Add tag">
                  <Plus />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {selectedTag ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-base">{selectedTag.name}</Label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={selectedTag.is_active !== false}
                      disabled={busyKey === `active-${selectedTag.id}`}
                      onCheckedChange={(on) =>
                        void run(`active-${selectedTag.id}`, () => setEnquiryTagActive(selectedTag.id, on))
                      }
                      aria-label="Tag available in New enquiry"
                    />
                    <span className="text-muted-foreground">
                      {selectedTag.is_active !== false ? "Shown in New enquiry" : "Hidden from New enquiry"}
                    </span>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tick who should see <strong>{selectedTag.name}</strong> enquiries.
                </p>
                <ScrollArea className="h-72 rounded-md border">
                  <ul className="flex flex-col divide-y">
                    {users.length === 0 ? (
                      <li className="p-3 text-sm text-muted-foreground">No active users.</li>
                    ) : (
                      users.map((p) => {
                        const checked = selectedMemberIds.has(p.id);
                        const key = `member-${selectedTag.id}-${p.id}`;
                        return (
                          <li key={p.id}>
                            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                              <Checkbox
                                checked={checked}
                                disabled={busyKey === key}
                                onCheckedChange={(on) =>
                                  void run(key, () =>
                                    setEnquiryTagMember({ tagId: selectedTag.id, userId: p.id, member: on === true })
                                  )
                                }
                                aria-label={`${profileDisplayName(p)} holds ${selectedTag.name}`}
                              />
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate font-medium">{profileDisplayName(p)}</span>
                                <span className="truncate text-xs text-muted-foreground">
                                  {[p.department, p.role].filter(Boolean).join(" · ") || p.email || ""}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </ScrollArea>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Pick or add a tag on the left.</p>
            )}
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

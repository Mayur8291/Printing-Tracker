import { useMemo, useState } from "react";
import { Search, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { groupAvatarPublicUrl, profileAvatarPublicUrl } from "@/avatarUtils";
import { conversationDisplayTitle, profileChatLabel } from "@/teamChatUtils";

function matchesLetters(haystack, query) {
  const q = query.trim().toLowerCase();
  const text = String(haystack ?? "").toLowerCase();
  if (!q) return true;
  return text.includes(q);
}

function rankMatch(haystack, query) {
  const q = query.trim().toLowerCase();
  const text = String(haystack ?? "").toLowerCase();
  if (!q) return 1;
  if (text.startsWith(q)) return 0;
  if (text.includes(q)) return 1;
  return 2;
}

export function ChatInboxSearch({
  mode,
  sessionUserId,
  teamProfiles,
  groupConversations,
  onPickPerson,
  onPickGroup
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const isGroups = mode === "groups";

  const people = useMemo(() => {
    if (isGroups) return [];
    return (teamProfiles ?? [])
      .filter((p) => p.id && p.id !== sessionUserId)
      .filter((p) => {
        const name = profileChatLabel(p);
        return matchesLetters(name, query) || matchesLetters(p.email, query);
      })
      .sort((a, b) => {
        const qa = rankMatch(profileChatLabel(a), query);
        const qb = rankMatch(profileChatLabel(b), query);
        if (qa !== qb) return qa - qb;
        return profileChatLabel(a).localeCompare(profileChatLabel(b));
      });
  }, [isGroups, teamProfiles, sessionUserId, query]);

  const groups = useMemo(() => {
    if (!isGroups) return [];
    return (groupConversations ?? [])
      .filter((conv) =>
        matchesLetters(conversationDisplayTitle(conv, sessionUserId, teamProfiles), query)
      )
      .sort((a, b) => {
        const ta = conversationDisplayTitle(a, sessionUserId, teamProfiles);
        const tb = conversationDisplayTitle(b, sessionUserId, teamProfiles);
        const ra = rankMatch(ta, query);
        const rb = rankMatch(tb, query);
        if (ra !== rb) return ra - rb;
        return ta.localeCompare(tb);
      });
  }, [isGroups, groupConversations, sessionUserId, teamProfiles, query]);

  function handleOpenChange(next) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function pickPerson(profile) {
    onPickPerson?.(profile.id);
    handleOpenChange(false);
  }

  function pickGroup(conversation) {
    onPickGroup?.(conversation.id);
    handleOpenChange(false);
  }

  const label = isGroups ? "Search groups" : "Search chats";
  const placeholder = isGroups ? "Type group name…" : "Type a name…";
  const emptyText = isGroups ? "No matching groups" : "No matching names";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="size-8" aria-label={label}>
          <Search />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-2 p-3">
        <Label htmlFor={`chat-inbox-search-${mode}`} className="sr-only">
          {label}
        </Label>
        <Input
          id={`chat-inbox-search-${mode}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
        <ScrollArea className="h-56 rounded-md border">
          {isGroups ? (
            groups.length === 0 ? (
              <p className="p-3 text-center text-sm text-muted-foreground">{emptyText}</p>
            ) : (
              <ul>
                {groups.map((conv) => {
                  const title = conversationDisplayTitle(conv, sessionUserId, teamProfiles);
                  const avatarUrl = groupAvatarPublicUrl(conv.avatar_path);
                  return (
                    <li key={conv.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-start gap-3 rounded-none px-3 py-2"
                        onClick={() => pickGroup(conv)}
                      >
                        {avatarUrl ? (
                          <PersonAvatar name={title} imageUrl={avatarUrl} size="sm" />
                        ) : (
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <UsersRound aria-hidden />
                          </span>
                        )}
                        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : people.length === 0 ? (
            <p className="p-3 text-center text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            <ul>
              {people.map((p) => (
                <li key={p.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-start gap-3 rounded-none px-3 py-2"
                    onClick={() => pickPerson(p)}
                  >
                    <PersonAvatar
                      name={p.full_name || profileChatLabel(p)}
                      email={p.email}
                      imageUrl={profileAvatarPublicUrl(p.avatar_path)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium">{profileChatLabel(p)}</span>
                      {p.department?.trim() ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.department.trim()}
                        </span>
                      ) : null}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

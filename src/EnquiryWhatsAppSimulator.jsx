import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { createEnquiry, profileDisplayName, updateEnquiryFields } from "./enquiryUtils";
import { insertEnquiryAssignmentNotification } from "./enquiryNotificationUtils";
import {
  findFallbackManagerProfile,
  lookupOrderForEnquiry,
  normalizeOrderCode,
  ownershipFromLookup,
  saveEnquiryFeedback
} from "./enquiryConciergeUtils";
import { uploadEnquiryPhotos, validateEnquiryPhotoFile } from "./enquiryAttachmentUtils";
import {
  CLOSE_SURVEY_FEEDBACK_BTN,
  CLOSE_SURVEY_RATINGS,
  CLOSE_SURVEY_SKIP_BTN,
  closeSurveyCommentPrompt,
  closeSurveyRatingPrompt,
  fetchEnquiryForSurvey,
  fetchOutboundForPhone
} from "./enquiryCloseNotify";
import { subscribePostgresChanges } from "./realtimeUtils";
import { viewerIsActive } from "./viewerUserListUtils";
import {
  SIM_BTN,
  emptySimSession,
  isGreeting,
  looksLikeOrderId,
  mainMenu,
  managerListMessage,
  resetSimDraft
} from "./enquiryWhatsAppSimulatorFlow";
import { MessageCircle, Send } from "lucide-react";

function bot(text, buttons) {
  return { id: crypto.randomUUID(), direction: "out", text, buttons: buttons || null, imageUrl: "" };
}

function customer(text, imageUrl) {
  return { id: crypto.randomUUID(), direction: "in", text: text || "", buttons: null, imageUrl: imageUrl || "" };
}

function afterHome(text) {
  const menu = mainMenu(text);
  return bot(menu.text, menu.buttons);
}

/**
 * Temporary fake WhatsApp (Scott Concierge path) that writes real Enquiry rows.
 */
export default function EnquiryWhatsAppSimulator({
  open,
  onOpenChange,
  sessionUserId,
  teamProfiles,
  isAdmin = false,
  onCreated
}) {
  const [phone, setPhone] = useState("+919876543210");
  const [customerName, setCustomerName] = useState("John Smith");
  const [session, setSession] = useState(() => emptySimSession("John Smith"));
  const [messages, setMessages] = useState(() => {
    const m = mainMenu();
    return [bot(m.text, m.buttons)];
  });
  const [draftText, setDraftText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testBypass, setTestBypass] = useState(true);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);
  const seenOutboundRef = useRef(new Set());

  const activeProfiles = useMemo(
    () =>
      [...(teamProfiles ?? [])]
        .filter((p) => viewerIsActive(p) && profileDisplayName(p) !== "—")
        .sort((a, b) => profileDisplayName(a).localeCompare(profileDisplayName(b))),
    [teamProfiles]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function ingestOutbound(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const fresh = [];
    for (const row of list) {
      if (!row?.id || seenOutboundRef.current.has(row.id)) continue;
      seenOutboundRef.current.add(row.id);
      fresh.push(row);
    }
    if (!fresh.length) return;
    const extra = fresh
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((row) => bot(row.text, Array.isArray(row.buttons) ? row.buttons : []));
    const last = fresh[fresh.length - 1];
    setSession((prev) => ({
      ...prev,
      surveyEnquiryId: last.enquiry_id || prev.surveyEnquiryId,
      state: prev.state === "idle" ? "survey_awaiting_feedback" : prev.state
    }));
    setMessages((prev) => [...prev, ...extra]);
  }

  async function pullOutbound() {
    try {
      ingestOutbound(await fetchOutboundForPhone(phone));
    } catch (e) {
      console.warn("close survey pull:", e.message);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    void pullOutbound();
    return subscribePostgresChanges({
      channelName: `enquiry-outbound-sim-${sessionUserId || "anon"}`,
      tables: ["enquiry_outbound_messages"],
      debounceMs: 200,
      onEvent: () => {
        void pullOutbound();
      }
    });
    // phone + open: re-pull when chat identity changes
  }, [open, phone, sessionUserId]);

  function push(nextSession, extraMessages) {
    setSession(nextSession);
    setMessages((prev) => [...prev, ...extraMessages]);
  }

  function startOver(name) {
    seenOutboundRef.current = new Set();
    const next = emptySimSession(name || customerName);
    const m = mainMenu();
    setSession(next);
    setMessages([bot(m.text, m.buttons)]);
    setError("");
    void pullOutbound();
  }

  async function fileTicket(nextSession, assignee, unknown) {
    const helpKind = nextSession.draft.helpKind || "regular";
    const helpTopic = helpKind === "custom_enquiry" ? "enquiry" : helpKind === "custom_product" ? "product_issue" : "regular";
    const orderType = helpKind === "regular" ? "regular" : "customized";
    const imageFiles = nextSession.draft.imageFiles || [];

    let row = await createEnquiry({
      createdBy: sessionUserId,
      form: {
        customer_name: nextSession.customerName || customerName,
        customer_phone: phone,
        product_details: nextSession.draft.issue,
        source: "WhatsApp",
        priority: "normal",
        notes: "Created from temporary WhatsApp simulator",
        order_id: nextSession.draft.orderId,
        order_type: orderType,
        help_topic: helpTopic,
        ownership_verified: Boolean(nextSession.draft.ownershipVerified),
        ...(assignee?.id && isAdmin
          ? {
              allowAssign: true,
              assignee_id: assignee.id,
              assigned_because_unknown: Boolean(unknown)
            }
          : {})
      }
    });

    if (imageFiles.length) {
      const uploaded = await uploadEnquiryPhotos({
        userId: sessionUserId,
        enquiryId: row.id,
        files: imageFiles
      });
      row = await updateEnquiryFields(row.id, {
        attachments: uploaded.map(({ path, name, mime, size }) => ({ path, name, mime, size }))
      });
    }

    if (assignee?.id && isAdmin) {
      await insertEnquiryAssignmentNotification({
        enquiryId: row.id,
        enquiryCode: row.enquiry_code,
        customerName: row.customer_name,
        assigneeId: assignee.id,
        assignedByUserId: sessionUserId
      });
    }

    onCreated?.(row);
    return row;
  }

  async function handleOrderOwned(next, lookup) {
    next.customerName = lookup.customerName || next.customerName || customerName;
    if (lookup.forceUnverified) {
      next.draft.ownershipVerified = false;
    } else {
      next.draft.ownershipVerified = true;
    }
    const helpKind = next.draft.helpKind;
    if (helpKind === "custom_delay") {
      const reset = resetSimDraft(next, next.customerName);
      push(reset, [
        afterHome(
          `Sorry for the delay on order ${lookup.orderId}. Current production stage: ${lookup.status || "in production"}. We will deliver as soon as possible.`
        )
      ]);
      return;
    }
    next.state = "help_awaiting_issue";
    push(next, [
      bot(
        helpKind === "custom_enquiry"
          ? "Please type your enquiry in one message."
          : "Now describe the issue in one message."
      )
    ]);
  }

  async function denyOrder(next) {
    const reset = resetSimDraft(next, next.customerName);
    push(reset, [
      afterHome(
        "We don't have an order with this Order ID for your registered mobile number. Please check the Order ID and try again."
      )
    ]);
  }

  async function handleInbound({ type, text, buttonId, file }) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const inboundText = String(text ?? "").trim();
      const shown = type === "image" ? customer("📷 Photo", file ? URL.createObjectURL(file) : "") : customer(inboundText || (buttonId || ""));
      setMessages((prev) => [...prev, shown]);

      let next = {
        ...session,
        customerName: customerName || session.customerName,
        draft: { ...session.draft, imageFiles: [...(session.draft.imageFiles || [])] }
      };

      if (buttonId === SIM_BTN.mainMenu || (type === "text" && isGreeting(inboundText))) {
        next = resetSimDraft(next, customerName);
        push(next, [afterHome("Hi I'm a Scott Concierge How Can I Help you")]);
        return;
      }

      const surveyRating = CLOSE_SURVEY_RATINGS.find((r) => r.id === buttonId);
      if (buttonId === CLOSE_SURVEY_FEEDBACK_BTN) {
        const prompt = closeSurveyRatingPrompt();
        next.state = "survey_awaiting_rating";
        push(next, [bot(prompt.text, prompt.buttons)]);
        return;
      }
      if (surveyRating) {
        const enquiryId = next.surveyEnquiryId;
        if (!enquiryId) {
          push(next, [bot("Feedback case was lost. Keep this chat open when the account manager closes the ticket.")]);
          return;
        }
        const enquiry = await fetchEnquiryForSurvey(enquiryId);
        if (!enquiry) {
          push(next, [bot("Could not load that closed case for feedback.")]);
          return;
        }
        await saveEnquiryFeedback({
          enquiry,
          rating: surveyRating.label,
          comment: "",
          sessionUserId,
          isAdmin
        });
        next.surveyRating = surveyRating.label;
        next.state = "survey_awaiting_comment";
        const prompt = closeSurveyCommentPrompt();
        push(next, [bot(prompt.text, prompt.buttons)]);
        return;
      }
      if (buttonId === CLOSE_SURVEY_SKIP_BTN) {
        next.state = "idle";
        push(resetSimDraft(next, next.customerName), [afterHome("Thanks for your feedback.")]);
        return;
      }
      if (next.state === "survey_awaiting_comment" && type === "text") {
        const enquiryId = next.surveyEnquiryId;
        if (!enquiryId || !next.surveyRating) {
          push(next, [bot("Please tap a star rating first.")]);
          return;
        }
        const enquiry = await fetchEnquiryForSurvey(enquiryId);
        if (!enquiry) {
          push(next, [bot("Could not load that closed case for feedback.")]);
          return;
        }
        await saveEnquiryFeedback({
          enquiry,
          rating: next.surveyRating,
          comment: inboundText,
          sessionUserId,
          isAdmin
        });
        next.state = "idle";
        push(resetSimDraft(next, next.customerName), [afterHome("Thanks for your feedback.")]);
        return;
      }

      if (buttonId === SIM_BTN.access) {
        push(next, [
          bot("Customer access. Are you a new member or an existing customer?", [
            { id: SIM_BTN.shopNew, title: "New member" },
            { id: SIM_BTN.existingCustomer, title: "Existing customer" },
            { id: SIM_BTN.mainMenu, title: "Main menu" }
          ])
        ]);
        return;
      }
      if (buttonId === SIM_BTN.shopNew) {
        setSession(resetSimDraft(next, customerName));
        return;
      }
      if (buttonId === SIM_BTN.existingCustomer) {
        push(resetSimDraft(next, customerName), [
          afterHome("Welcome back. Sign in to your Scott International account (placeholder login link).")
        ]);
        return;
      }

      if (buttonId === SIM_BTN.track) {
        next.state = "awaiting_track_order_id";
        next.draft = { ...emptySimSession(customerName).draft };
        push(next, [bot("Please send your Order ID (example: SC123456).")]);
        return;
      }

      if (buttonId === SIM_BTN.help) {
        push(next, [
          bot("What kind of order needs help?", [
            { id: SIM_BTN.helpRegular, title: "Regular Order" },
            { id: SIM_BTN.helpCustom, title: "Customized order" },
            { id: SIM_BTN.mainMenu, title: "Main menu" }
          ])
        ]);
        return;
      }
      if (buttonId === SIM_BTN.helpRegular) {
        next.state = "help_awaiting_order_id";
        next.draft = { ...emptySimSession(customerName).draft, helpKind: "regular" };
        push(next, [bot("Regular order help. First send your Order ID.")]);
        return;
      }
      if (buttonId === SIM_BTN.helpCustom) {
        next = resetSimDraft(next, customerName);
        push(next, [
          bot("Customized order. How can we help?", [
            { id: SIM_BTN.helpCustomEnquiries, title: "Enquiries" },
            { id: SIM_BTN.helpCustomConcerns, title: "Concerns" },
            { id: SIM_BTN.mainMenu, title: "Main menu" }
          ])
        ]);
        return;
      }
      if (buttonId === SIM_BTN.helpCustomEnquiries) {
        next.state = "help_awaiting_order_id";
        next.draft = { ...emptySimSession(customerName).draft, helpKind: "custom_enquiry" };
        push(next, [bot("Customized enquiry. First send your Order ID.")]);
        return;
      }
      if (buttonId === SIM_BTN.helpCustomConcerns) {
        push(next, [
          bot("What is your concern? Delay, or Product related issues.", [
            { id: SIM_BTN.helpCustomDelay, title: "Delay" },
            { id: SIM_BTN.helpCustomProduct, title: "Product issues" },
            { id: SIM_BTN.mainMenu, title: "Main menu" }
          ])
        ]);
        return;
      }
      if (buttonId === SIM_BTN.helpCustomDelay) {
        next.state = "help_awaiting_order_id";
        next.draft = { ...emptySimSession(customerName).draft, helpKind: "custom_delay" };
        push(next, [bot("Delay on a customized order. First send your Order ID.")]);
        return;
      }
      if (buttonId === SIM_BTN.helpCustomProduct) {
        next.state = "help_awaiting_order_id";
        next.draft = { ...emptySimSession(customerName).draft, helpKind: "custom_product" };
        push(next, [bot("Product related issue on a customized order. First send your Order ID.")]);
        return;
      }

      if (next.state === "awaiting_track_order_id" && type === "text") {
        if (!looksLikeOrderId(inboundText)) {
          push(next, [bot("Please send a valid Order ID like SC123456, or type menu.")]);
          return;
        }
        const lookup = await lookupOrderForEnquiry(inboundText);
        const ownership = ownershipFromLookup(lookup, phone);
        if (lookup.found && ownership.verified) {
          push(resetSimDraft(next, lookup.customerName || customerName), [
            afterHome(
              `Order ${lookup.orderId}\nName: ${lookup.customerName || customerName}\nStatus: ${lookup.status || "—"}\nPhone matched this chat.`
            )
          ]);
          return;
        }
        if (testBypass) {
          push(resetSimDraft(next, lookup.customerName || customerName), [
            afterHome(
              `Test bypass: ${lookup.found ? "order found but phone did not match" : "order not in dashboard"}. Showing sample track anyway for ${normalizeOrderCode(inboundText)}.`
            )
          ]);
          return;
        }
        await denyOrder(next);
        return;
      }

      if (next.state === "help_awaiting_order_id" && type === "text") {
        if (!looksLikeOrderId(inboundText)) {
          push(next, [bot("That does not look like an Order ID. Send one like SC123456, or type menu to start over.")]);
          return;
        }
        const orderId = normalizeOrderCode(inboundText);
        const lookup = await lookupOrderForEnquiry(orderId);
        const ownership = ownershipFromLookup(lookup, phone);
        next.draft.orderId = orderId;
        if (lookup.found && ownership.verified) {
          await handleOrderOwned(next, lookup);
          return;
        }
        if (testBypass) {
          next.draft.ownershipVerified = false;
          next.customerName = lookup.customerName || next.customerName || customerName;
          const note = bot(
            `Test bypass: ${lookup.found ? "phone did not match order" : "no order row"}. Continuing so you can test Enquiry.`
          );
          setMessages((prev) => [...prev, note]);
          await handleOrderOwned(next, {
            ...lookup,
            found: true,
            orderId,
            customerName: next.customerName,
            status: lookup.status || "pending",
            forceUnverified: true
          });
          return;
        }
        await denyOrder(next);
        return;
      }

      if (next.state === "help_awaiting_issue" && type === "text") {
        if (inboundText.length < 8) {
          push(next, [
            bot(
              next.draft.helpKind === "custom_enquiry"
                ? "Please type a bit more about your enquiry."
                : "Please describe the issue in a bit more detail (what happened, what is wrong)."
            )
          ]);
          return;
        }
        next.draft.issue = inboundText;
        if (next.draft.helpKind === "custom_enquiry") {
          if (!isAdmin) {
            const row = await fileTicket(next, null, false);
            push(resetSimDraft(next, next.customerName), [
              afterHome(`Ticket created: ${row.enquiry_code}. Admin will assign. Non-admin cannot assign.`)
            ]);
            return;
          }
          next.state = "help_awaiting_manager";
          const list = managerListMessage(activeProfiles);
          push(next, [bot(list.text, list.buttons)]);
          return;
        }
        next.state = "help_awaiting_images";
        push(next, [bot("Please send a clear photo of the issue. You can send more than one. When finished, tap Done.")]);
        return;
      }

      if (next.state === "help_awaiting_images") {
        if (type === "image" && file) {
          const bad = validateEnquiryPhotoFile(file);
          if (bad) {
            push(next, [bot(bad)]);
            return;
          }
          next.draft.imageFiles.push(file);
          push(next, [
            bot(`Saved photo ${next.draft.imageFiles.length}. Send another photo or tap Done.`, [
              { id: SIM_BTN.imagesDone, title: "Done" },
              { id: SIM_BTN.imagesMore, title: "Add more" },
              { id: SIM_BTN.mainMenu, title: "Main menu" }
            ])
          ]);
          return;
        }
        if (buttonId === SIM_BTN.imagesMore) {
          push(next, [bot("Send the next photo now.")]);
          return;
        }
        if (buttonId === SIM_BTN.imagesDone || /^done$/i.test(inboundText)) {
          if (!next.draft.imageFiles.length) {
            push(next, [bot("I still need at least one valid photo of the issue (jpg, png, or webp).")]);
            return;
          }
          if (!isAdmin) {
            const row = await fileTicket(next, null, false);
            push(resetSimDraft(next, next.customerName), [
              afterHome(`Ticket created: ${row.enquiry_code}. Admin will assign. Non-admin cannot assign.`)
            ]);
            return;
          }
          next.state = "help_awaiting_manager";
          const list = managerListMessage(activeProfiles);
          push(next, [bot(list.text, list.buttons)]);
          return;
        }
        if (type === "text") {
          push(next, [bot("Please send a photo, or tap Done when you have uploaded at least one image.")]);
          return;
        }
      }

      if (next.state === "help_awaiting_manager") {
        if (!isAdmin) {
          const row = await fileTicket(next, null, false);
          push(resetSimDraft(next, next.customerName), [
            afterHome(`Ticket created: ${row.enquiry_code}. Admin will assign. Non-admin cannot assign.`)
          ]);
          return;
        }
        const unknown = buttonId === SIM_BTN.managerUnknown;
        let assignee = null;
        if (unknown) {
          assignee = findFallbackManagerProfile(teamProfiles);
        } else if (buttonId?.startsWith("manager_")) {
          const id = buttonId.slice("manager_".length);
          assignee = activeProfiles.find((p) => p.id === id) || null;
        } else if (type === "text") {
          const q = inboundText.toLowerCase();
          assignee = activeProfiles.find((p) => profileDisplayName(p).toLowerCase() === q) || null;
        }
        if (!assignee || !next.draft.orderId || !next.draft.issue) {
          const list = managerListMessage(activeProfiles);
          push(next, [
            bot(
              assignee
                ? "Something missing in this help request. Type menu and start Help with order again."
                : `Please pick your account manager from the list, or type their name. Need a team user named Gargi for unknown-AM.`,
              assignee ? null : list.buttons
            )
          ]);
          return;
        }
        const row = await fileTicket(next, assignee, unknown);
        const reset = resetSimDraft(next, next.customerName);
        push(reset, [
          afterHome(
            unknown
              ? `Ticket created: ${row.enquiry_code}. We assigned this to Gargi, who will verify the issue and contact you. Status: Assigned (pending pick).`
              : `Ticket created: ${row.enquiry_code}. ${profileDisplayName(assignee)} will verify the issue and contact you. Status: Assigned (pending pick).`
          )
        ]);
        return;
      }

      if (type === "image") {
        push(next, [bot("I got a photo, but I am not collecting images right now. Tap Help with order if you need to report a problem.")]);
        return;
      }

      push(next, [afterHome("I did not catch that. How can I help you?")]);
    } catch (e) {
      setError(e.message || "Simulator failed.");
    } finally {
      setBusy(false);
    }
  }

  function sendText() {
    const text = draftText.trim();
    if (!text) return;
    setDraftText("");
    void handleInbound({ type: "text", text });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" aria-hidden />
            WhatsApp simulator
            <Badge variant="outline">Temporary</Badge>
          </SheetTitle>
          <SheetDescription>
            Fake Concierge chat. Tickets land on this Enquiry tab. Keep this sheet open — when the account
            manager taps Close, the feedback text appears here for this phone.
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-2 border-b px-4 py-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="sim-phone">Chat phone</Label>
            <Input id="sim-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sim-name">Customer name</Label>
            <Input id="sim-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div className="flex items-center justify-between gap-2 sm:col-span-2">
            <Label htmlFor="sim-bypass" className="text-xs font-normal text-muted-foreground">
              Test bypass — still file ticket if phone/order mismatch
            </Label>
            <Switch id="sim-bypass" checked={testBypass} onCheckedChange={setTestBypass} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col bg-[#ece5dd]">
          <div className="bg-[#075e54] px-4 py-2 text-sm font-medium text-white">Scott Concierge · fake WhatsApp</div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {messages.map((m) => (
                <div key={m.id} className={cn("flex", m.direction === "in" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow",
                      m.direction === "in" ? "bg-[#dcf8c6] text-zinc-900" : "bg-white text-zinc-900"
                    )}
                  >
                    {m.imageUrl ? (
                      <img src={m.imageUrl} alt="" className="mb-1 max-h-40 rounded-md" />
                    ) : null}
                    {m.text ? <p className="whitespace-pre-wrap">{m.text}</p> : null}
                    {m.buttons?.length ? (
                      <div className="mt-2 flex flex-col gap-1">
                        {m.buttons.map((b) => (
                          <Button
                            key={b.id}
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-auto justify-start whitespace-normal bg-white"
                            disabled={busy}
                            onClick={() => void handleInbound({ type: "button", buttonId: b.id, text: b.title })}
                          >
                            {b.title}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        </div>

        <div className="space-y-2 border-t bg-background p-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Input
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Type a message (try hi)"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendText();
                }
              }}
            />
            <Button type="button" size="icon" disabled={busy} onClick={sendText} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleInbound({ type: "image", file });
              }}
            />
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              Send photo
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => startOver(customerName)}>
              Reset chat
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

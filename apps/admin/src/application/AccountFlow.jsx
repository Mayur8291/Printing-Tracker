import { useState } from "react";
import CanonicalLocationFields from "../squad/features/people/CanonicalLocationFields";
import {canonicalLocation} from "../squad/features/people/addressModel";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";

const TITLES = { register: "Create your customer account", confirm: "Confirm your account", recovery: "Reset your password", invite: "Accept your invitation" };
const METHODS = { register: ["requestRegistration", "completeRegistration"], confirm: ["requestConfirmation", "completeConfirmation"], recovery: ["requestRecovery", "completeRecovery"], invite: [null, "acceptInvitation"] };
export default function AccountFlow({ sdk, kind, onBack }) {
  const mode = METHODS[kind] ? kind : "recovery";
  const [fields, setFields] = useState({ email: "", first_name: "", last_name: "", company_name: "", phone: "", address: "", state: "", city: "", zip_code: "", gst_no: "", requestId: new URLSearchParams(window.location.search).get("request_id") || "", code: "", password: "", confirm: "" });
  const [phase, setPhase] = useState(mode === "invite" ? "proof" : "request"); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [result, setResult] = useState(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const field = (name, label, type = "text", autoComplete) => <div className="space-y-2" key={name}><Label htmlFor={`account-${name}`}>{label}</Label><Input id={`account-${name}`} type={type} value={fields[name]} autoComplete={autoComplete} required={!["last_name","gst_no"].includes(name)} inputMode={name==="phone"||name==="zip_code"?"numeric":undefined} maxLength={name==="phone"?10:name==="zip_code"?6:undefined} pattern={name==="phone"?"[0-9]{10}":name==="zip_code"?"[0-9]{6}":undefined} disabled={busy || (name === "email" && phase === "proof" && mode !== "invite")} minLength={name === "password" || name === "confirm" ? 12 : undefined} aria-describedby={name === "password" ? "account-password-help" : undefined} onChange={(e) => setFields((old) => ({ ...old, [name]: e.target.value }))} />{name === "password" && <p id="account-password-help" className="text-xs leading-relaxed text-muted-foreground">Use at least 12 characters. The maximum is 72 bytes; accented characters and emoji can use more than one byte.</p>}</div>;
  async function submit(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const email = fields.email.trim().toLowerCase();
      if (phase === "request") {
        if (mode === "register") {
          const profile = Object.fromEntries(["first_name", "last_name", "company_name", "phone"].map((key) => [key, fields[key].trim()]));
          if(!/^[0-9]{10}$/.test(profile.phone)) throw new Error("Enter a ten-digit phone number.");
          if(fields.gst_no.trim()) profile.gst_no=fields.gst_no.trim();
          const location = canonicalLocation(fields.state,fields.city);
          if(!location) throw new Error("Choose a state and city from the list.");
          if(!/^[0-9]{6}$/.test(fields.zip_code.trim())) throw new Error("Enter a six-digit postal code.");
          profile.addresses = [{address:fields.address.trim(),...location,zip_code:fields.zip_code.trim()}];
          await sdk.requestRegistration(email, profile, requestId);
        } else await sdk[METHODS[mode][0]](email, requestId);
        setPhase("proof");
      } else {
        if (fields.password.length < 12) throw new Error("Use at least 12 characters for your password.");
        if (new TextEncoder().encode(fields.password).byteLength > 72) throw new Error("Your password is too long. Use no more than 72 bytes; accented characters and emoji can use more than one byte.");
        if (fields.password !== fields.confirm) throw new Error("The passwords do not match.");
        const response = await sdk[METHODS[mode][1]]({ requestId: mode === "invite" ? fields.requestId.trim() : requestId, email, code: fields.code.trim(), password: fields.password });
        setFields((old) => ({ ...old, password: "", confirm: "", code: "" })); setResult(response);
      }
    } catch (cause) { setError(cause.code === "INVALID_OR_EXPIRED_CODE" ? `This verification code is incorrect or has expired. Check the code in your email. ${mode === "invite" ? "If it has expired, ask the person who invited you for a new invitation." : "If it has expired, return to sign in and restart this process to request a new code."}` : cause.message || "The request could not be completed."); }
    finally { setBusy(false); }
  }
  return <div className="flex h-svh flex-col items-center overflow-y-auto bg-muted/30 px-4 py-8 sm:py-10"><Card className="my-auto w-full max-w-lg shrink-0 shadow-sm"><CardHeader>
    <img src="/brand-logo.png" alt="Scott" className="mb-3 size-12" /><CardTitle className="text-2xl">{TITLES[mode]}</CardTitle>
    <CardDescription>{result ? "Your account request has been completed." : phase === "proof" ? "Enter the verification details from your email and choose your password." : "Use the email address associated with your business."}</CardDescription>
  </CardHeader><CardContent>{result ? <div className="space-y-5"><p role="status">{result.next === "await_approval" ? "Your email is confirmed. Your account is awaiting business approval before you can sign in." : "Your account is ready. Sign in with your password."}</p><Button onClick={onBack}>Back to sign in</Button></div> : <form onSubmit={submit} className="space-y-4">
    {field("email", "Email", "email", "email")}
    {mode === "register" && phase === "request" && <div className="grid gap-4 sm:grid-cols-2">{[["first_name","First name"],["last_name","Last name (optional)"],["company_name","Company"],["phone","Phone"],["address","Address"],["zip_code","Postal code"],["gst_no","GST number (optional)"]].map(([key,label]) => field(key,label))}<div className="sm:col-span-2"><CanonicalLocationFields idPrefix="account" value={{state:fields.state,city:fields.city}} onChange={location=>setFields(old=>({...old,...location}))} disabled={busy}/></div></div>}
    {phase === "proof" && <>{mode === "invite" && field("requestId", "Invitation request ID")}{field("code", "Verification code", "text", "one-time-code")}{field("password", "New password", "password", "new-password")}{field("confirm", "Confirm password", "password", "new-password")}</>}
    {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : phase === "proof" ? "Complete verification" : "Send verification email"}</Button>
    <Button type="button" variant="ghost" className="w-full" onClick={onBack}>Back to sign in</Button>
    {mode === "recovery" && <a className="block text-center text-sm underline underline-offset-4" href="/account/staff-recovery">Printing Tracker staff password help</a>}
  </form>}</CardContent></Card></div>;
}

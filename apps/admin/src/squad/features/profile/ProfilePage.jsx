import { createClient } from "@supabase/supabase-js";
import { createSquadClient } from "@canto/shared/squad";
import { getEnvironmentConfig } from "../../../runtimeEnv";
import AccountClosure from "../people/AccountClosure";
import DealerPreferences from "../people/DealerPreferences";
import AddressBook from "../people/AddressBook";
import CoordinatorRequests from "../people/CoordinatorRequests";
import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { PageHeader, SectionCard, Field, DetailList, MediaField } from "../../components/index.js";
import { useSquad, useSquadCommand } from "../../data/hooks";

export default function ProfilePage({ sdk, identity, canWrite, ...props }) {
  const { refreshIdentity, environment, onSignOut } = useSquad();
  async function reauthenticate(password) {
    const { url, anonKey } = getEnvironmentConfig(environment);
    // A separate in-memory session proves the password without replacing the active app session.
    const proof = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await proof.auth.signInWithPassword({ email: identity.email, password });
    if (error) throw error;
    if (!data.session || data.user?.id !== identity.auth_id || data.user?.role !== 'sa_app') {
      await proof.auth.signOut({ scope: 'local' });
      throw new Error('Account ownership could not be confirmed.');
    }
    // No automatic refresh: an interrupted closure must retry its original authenticated request.
    return createSquadClient(proof);
  }
  const [fields, setFields] = useState({ name: identity.name || "", phone: identity.phone || "", company_name: identity.company_name || "", first_name: identity.first_name || "", last_name: identity.last_name || "" });
  const [saved, setSaved] = useState(false); const command = useSquadCommand();
  async function submit(event) {
    event.preventDefault(); setSaved(false);
    try { await command.run((cmd) => sdk.saveProfile(fields, cmd), { key: "profile.save", payload: fields, expectedVersion: identity.version }); setSaved(true); await refreshIdentity(); } catch { /* Error is displayed below. */ }
  }
  return <div className="space-y-6"><PageHeader title="My account" description="Your profile and access details." /><div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]"><SectionCard title="Profile details" description="Keep your contact details up to date."><MediaField target={{resource:"users",record_id:identity.id,field:"profile_image"}} label="Profile photo" canWrite={canWrite} onSaved={refreshIdentity} /><form onSubmit={submit} className="space-y-5"><div className="grid gap-5 sm:grid-cols-2">{[["name","Display name"],["phone","Phone"], ...(identity.role === 3 || identity.role === 10 ? [["first_name","First name"],["last_name","Last name"],["company_name","Company"]] : [])].map(([key,label]) => <Field key={key} label={label} required={key === "name"}><Input value={fields[key]} onChange={(e) => { setFields({ ...fields, [key]: e.target.value }); setSaved(false); }} disabled={!canWrite || command.pending} /></Field>)}</div>{command.error && <p role="alert" className="text-sm text-destructive">{command.error.message}</p>}{saved && <p role="status" className="text-sm text-emerald-700">Profile saved.</p>}<Button type="submit" disabled={!canWrite || command.pending}>{command.pending ? "Saving…" : "Save profile"}</Button></form></SectionCard><SectionCard title="Account access"><DetailList items={[{label:"Email",value:identity.email},{label:"Role",value:identity.role_name},{label:"Account",value:identity.approved === false ? "Awaiting approval" : "Active"}]} /><p className="mt-5 text-xs leading-relaxed text-muted-foreground">Your administrator manages your role and workspace access.</p></SectionCard></div>{[3,10].includes(identity.role) && <AddressBook {...props} sdk={sdk} identity={identity} canWrite={canWrite} onSaved={refreshIdentity} />}{identity.role === 10 && <DealerPreferences {...props} sdk={sdk} identity={identity} canWrite={canWrite} />}{identity.role === 3 && <CoordinatorRequests {...props} sdk={sdk} identity={identity} canWrite={canWrite} />}{identity.role === 3 && <AccountClosure identity={identity} canWrite={canWrite} reauthenticate={reauthenticate} onClosed={onSignOut} />}</div>;
}

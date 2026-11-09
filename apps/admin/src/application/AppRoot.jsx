import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Navigate, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createSquadClient } from "@canto/shared/squad";
import { supabase } from "../supabaseClient";
import { getRuntimeEnv } from "../runtimeEnv";
import LoginPage from "../components/auth/LoginPage";
import { Button } from "../components/ui/button";
import { SquadContext } from "../squad/data/hooks";
import { ROLE_NAMES } from "../squad/navigation/registry";
import AccountFlow from "./AccountFlow";
import WorkspaceErrorBoundary from "./WorkspaceErrorBoundary";

const TrackerApp = lazy(() => import("../App"));
const SquadApp = lazy(() => import("../squad/SquadApp"));
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const sdk = createSquadClient(supabase);
const environment = getRuntimeEnv().env;

function SessionMessage({ title, message, retry, signOut }) {
  return <div className="grid min-h-svh place-items-center bg-background p-6"><section aria-live="polite" className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
    <img src="/brand-logo.png" alt="Scott" className="mx-auto mb-5 size-12" />
    <h1 className="text-xl font-semibold tracking-tight">{title}</h1><p className="mt-3 text-sm text-muted-foreground">{message}</p>
    {retry || signOut ? <div className="mt-6 flex justify-center gap-2">{retry && <Button onClick={retry}>Try again</Button>}{signOut && <Button variant="outline" onClick={signOut}>Sign out</Button>}</div> : null}
  </section></div>;
}

function SignIn() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const navigate = useNavigate();
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      setPassword("");
    } catch (cause) { setError(cause.message || "Sign-in could not be completed. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="flex h-svh flex-col items-center overflow-y-auto bg-gradient-to-b from-muted/50 to-background px-4 py-8"><div className="my-auto w-full max-w-md [&>div]:min-h-0 [&>div]:bg-none [&>div]:p-0"><LoginPage email={email} password={password} showPassword={show} signingIn={busy} authError={error}
    onEmailChange={(e) => setEmail(e.target.value)} onPasswordChange={(e) => setPassword(e.target.value)}
    onTogglePassword={() => setShow((value) => !value)} onSubmit={submit} onForgotPassword={() => navigate("/account/recovery")} />
    <div className="mt-5 flex flex-wrap justify-center gap-x-2 gap-y-1 text-sm">
      <Button variant="link" onClick={() => navigate("/account/register")}>Create a customer account</Button>
      <Button variant="link" onClick={() => navigate("/account/confirm")}>Confirm your account</Button>
      <Button variant="link" onClick={() => navigate("/account/invite")}>Accept an invitation</Button>
    </div></div></div>;
}

function ApplicationBoundary() {
  const location = useLocation(); const navigate = useNavigate();
  const [state, setState] = useState({ status: "loading" });
  const generation = useRef(0); const mounted = useRef(true); const token = useRef(null);
  const sessionEpoch = useRef(0); const pendingSession = useRef(null); const observedSession = useRef(null); const observedUser = useRef(null);
  const invalidateSessionCheck = useCallback(() => {
    ++sessionEpoch.current; ++generation.current; pendingSession.current = null;
  }, []);
  const resolveSession = useCallback(async (force = false) => {
    if (force === true) invalidateSessionCheck();
    const epoch = sessionEpoch.current;
    let session;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      session = data.session;
    } catch (error) {
      if (mounted.current && epoch === sessionEpoch.current) {
        invalidateSessionCheck(); queryClient.clear(); setState({ status: "error", error });
      }
      return;
    }
    if (!mounted.current || epoch !== sessionEpoch.current) return;
    const key = session ? `${session.user.id}:${session.access_token}` : null;
    observedSession.current = key; observedUser.current = session?.user.id ?? null;
    const existing = pendingSession.current;
    if (existing?.key === key && existing.epoch === epoch) return existing.promise;
    const request = ++generation.current;
    const pending = { key, epoch, promise: null };
    // Share only an identical in-flight check, never a completed authorization result.
    // A new Auth event invalidates its epoch before any asynchronous work starts.
    pending.promise = (async () => {
      try {
        if (!session) {
          if (mounted.current && request === generation.current) {
            token.current = null; queryClient.clear(); setState({ status: "anonymous" });
          }
          return;
        }
        const verified = await supabase.auth.getUser();
        if (!mounted.current || request !== generation.current) return;
        if (verified.error || !verified.data.user) throw verified.error || new Error("Your session has expired. Sign in again.");
        const user = verified.data.user;
        if (user.id !== session.user.id) throw new Error("Your account changed. Sign in again.");
        let next;
        if (user.role === "sa_app") {
          const [identity, bootstrap] = await Promise.all([sdk.me(), sdk.bootstrap("web", "1.0.0")]);
          if (bootstrap.api_version !== 1 || bootstrap.update_required) throw new Error("A newer application version is required. Reload the page to update your workspace.");
          if (identity.auth_id !== user.id || !Object.hasOwn(ROLE_NAMES, identity.role)) throw new Error("This account is not eligible for a Squad workspace.");
          next = { status: "squad", identity: { ...identity, role_name: ROLE_NAMES[identity.role] }, session };
        } else if (user.role === "authenticated") {
          const membership = await supabase.from("profiles").select("id,role").eq("id", user.id).maybeSingle();
          if (membership.error) throw membership.error;
          if (!membership.data) throw new Error("This account has no active staff workspace. Contact your administrator.");
          next = { status: "tracker", session };
        } else throw new Error("This account has no active application workspace.");
        if (mounted.current && request === generation.current) {
          if (token.current !== session.access_token) queryClient.clear();
          token.current = session.access_token; setState(next);
        }
      } catch (error) {
        if (mounted.current && request === generation.current) { queryClient.clear(); setState({ status: "error", error }); }
      }
    })().finally(() => { if (pendingSession.current === pending) pendingSession.current = null; });
    pendingSession.current = pending;
    return pending.promise;
  }, [invalidateSessionCheck]);
  useEffect(() => {
    mounted.current = true; let timer;
    // Keep Auth callbacks synchronous: another Auth call inside the callback can deadlock its lock.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") { clearTimeout(timer); invalidateSessionCheck(); observedSession.current = null; observedUser.current = null; token.current = null; queryClient.clear(); setState({ status: "anonymous" }); return; }
      const key = session ? `${session.user.id}:${session.access_token}` : null;
      if (observedUser.current && session?.user.id !== observedUser.current) {
        queryClient.clear(); setState({ status: "loading" });
      }
      observedUser.current = session?.user.id ?? null;
      if (key !== observedSession.current || ["TOKEN_REFRESHED", "USER_UPDATED", "PASSWORD_RECOVERY"].includes(event)) {
        invalidateSessionCheck(); observedSession.current = key;
      }
      if (["INITIAL_SESSION", "TOKEN_REFRESHED", "USER_UPDATED", "PASSWORD_RECOVERY"].includes(event) || session?.access_token !== token.current) {
        clearTimeout(timer); timer = setTimeout(resolveSession, 0);
      }
    });
    void resolveSession();
    const foreground = () => { if (document.visibilityState === "visible") void resolveSession(); };
    window.addEventListener("focus", foreground); document.addEventListener("visibilitychange", foreground);
    return () => { mounted.current = false; invalidateSessionCheck(); clearTimeout(timer); subscription.unsubscribe(); window.removeEventListener("focus", foreground); document.removeEventListener("visibilitychange", foreground); };
  }, [resolveSession, invalidateSessionCheck]);
  useEffect(() => {
    const expires = state.identity?.write_state?.expires_at;
    if (state.status !== 'squad' || state.identity.write_state?.mode !== 'test' || !expires) return;
    const delay = Math.max(0, Date.parse(expires) - Date.now());
    if (!Number.isFinite(delay)) return;
    const expiry = setTimeout(() => void resolveSession(true), Math.min(delay + 25, 2147483647));
    return () => clearTimeout(expiry);
  }, [state.identity?.write_state?.expires_at, state.identity?.write_state?.mode, state.status, resolveSession]);
  const signOut = useCallback(async () => {
    queryClient.clear(); invalidateSessionCheck(); setState({ status: "loading" });
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) setState({ status: "error", error });
    else { token.current = null; setState({ status: "anonymous" }); navigate("/", { replace: true }); }
  }, [navigate, invalidateSessionCheck]);
  const value = useMemo(() => {
    if (state.status !== "squad") return null;
    const identity = state.identity;
    const writeState = identity.write_state ?? { mode: "mirror", allowed: false };
    return { sdk, identity, environment, canWrite: writeState.allowed === true, writeState,
      scope: JSON.stringify([environment, identity.auth_id, identity.role, identity.version, identity.capabilities, writeState]),
      onAuthorizationError: () => resolveSession(true), refreshIdentity: () => resolveSession(true), onSignOut: signOut, supabase };
  }, [state, resolveSession, signOut]);
  if (state.status === "loading") return <SessionMessage title="Opening your workspace" message="Checking your session and access…" />;
  if (state.status === "error") return <SessionMessage title="Your workspace is unavailable" message={state.error?.message || "Please sign in again or contact your administrator."} retry={resolveSession} signOut={signOut} />;
  if (state.status === "anonymous") {
    if (location.pathname === "/account/staff-recovery") return <Suspense fallback={<SessionMessage title="Opening account help" />}><TrackerApp /></Suspense>;
    if (location.pathname.startsWith("/account/")) return <AccountFlow sdk={sdk} kind={location.pathname.split("/")[2]} onBack={() => navigate("/")} />;
    return <SignIn />;
  }
  if (state.status === "tracker") return <Suspense fallback={<SessionMessage title="Opening your dashboard" />}><TrackerApp /></Suspense>;
  if (!location.pathname.startsWith("/squad/")) return <Navigate to="/squad/home" replace />;
  return <SquadContext.Provider value={value}><Suspense fallback={<SessionMessage title="Opening your workspace" />}><SquadApp key={value.scope} /></Suspense></SquadContext.Provider>;
}

export default function AppRoot() {
  return <WorkspaceErrorBoundary><QueryClientProvider client={queryClient}><BrowserRouter><ApplicationBoundary /></BrowserRouter></QueryClientProvider></WorkspaceErrorBoundary>;
}

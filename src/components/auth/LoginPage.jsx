import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function PasswordField({ id, label, value, onChange, show, onToggle, autoComplete, placeholder }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          placeholder={placeholder ?? "••••••••"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required
          className="pr-16"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-0 top-0 h-full rounded-l-none px-3 text-xs text-muted-foreground"
          onClick={onToggle}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? "Hide" : "Show"}
        </Button>
      </div>
    </div>
  );
}

export default function LoginPage({
  mode = "signIn",
  email,
  password,
  newPassword,
  confirmPassword,
  showPassword,
  showNewPassword,
  showConfirmPassword,
  authError,
  infoMessage,
  forgotStatus,
  signingIn,
  forgotBusy,
  onEmailChange,
  onPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onTogglePassword,
  onToggleNewPassword,
  onToggleConfirmPassword,
  onSubmit,
  onForgotPassword,
  onBackToSignIn,
  onCheckForgotStatus,
  onRequestPasswordReset,
  onCompletePasswordReset,
  themeToggle
}) {
  const isForgot = mode === "forgot";
  const isSetPassword = mode === "setPassword";

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center bg-gradient-to-b from-muted/50 to-background p-4">
      {themeToggle}
      <Card className="w-full max-w-md border shadow-lg">
        <CardHeader className="space-y-4 pb-2 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl border bg-primary/5 shadow-sm">
            <img src="/brand-logo.png" alt="" className="size-11" width={44} height={44} />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl font-semibold tracking-tight">Scott Dashboard</CardTitle>
            <CardDescription>
              {isForgot
                ? "Request a password reset or check approval status"
                : isSetPassword
                  ? "Set your new password"
                  : "Sign in to your operations workspace"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isForgot ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (forgotStatus === "approved") {
                  onCompletePasswordReset?.(e);
                } else if (forgotStatus === "none" || !forgotStatus) {
                  onRequestPasswordReset?.(e);
                } else {
                  onCheckForgotStatus?.(e);
                }
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={onEmailChange}
                  onBlur={() => onCheckForgotStatus?.()}
                  required
                  autoComplete="email"
                />
              </div>

              {forgotStatus === "approved" ? (
                <>
                  <PasswordField
                    id="new-password"
                    label="New password"
                    value={newPassword}
                    onChange={onNewPasswordChange}
                    show={showNewPassword}
                    onToggle={onToggleNewPassword}
                    autoComplete="new-password"
                  />
                  <PasswordField
                    id="confirm-password"
                    label="Confirm new password"
                    value={confirmPassword}
                    onChange={onConfirmPasswordChange}
                    show={showConfirmPassword}
                    onToggle={onToggleConfirmPassword}
                    autoComplete="new-password"
                  />
                </>
              ) : null}

              {infoMessage ? (
                <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
                  {infoMessage}
                </p>
              ) : null}
              {authError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {authError}
                </p>
              ) : null}

              {forgotStatus === "approved" ? (
                <Button type="submit" className="w-full" size="lg" disabled={forgotBusy}>
                  {forgotBusy ? "Updating…" : "Update password"}
                </Button>
              ) : forgotStatus === "pending" ? (
                <Button type="button" className="w-full" size="lg" variant="outline" disabled>
                  Waiting for admin approval
                </Button>
              ) : (
                <>
                  <Button type="button" className="w-full" variant="outline" disabled={forgotBusy} onClick={onCheckForgotStatus}>
                    {forgotBusy ? "Checking…" : "Check status"}
                  </Button>
                  <Button type="submit" className="w-full" size="lg" disabled={forgotBusy}>
                    {forgotBusy ? "Submitting…" : "Request password reset"}
                  </Button>
                </>
              )}

              <Button type="button" variant="ghost" className="w-full" onClick={onBackToSignIn}>
                <ArrowLeft className="size-4" />
                Back to sign in
              </Button>
            </form>
          ) : isSetPassword ? (
            <form onSubmit={onCompletePasswordReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input id="login-email" type="email" value={email} readOnly className="bg-muted/40" />
              </div>
              <PasswordField
                id="new-password"
                label="New password"
                value={newPassword}
                onChange={onNewPasswordChange}
                show={showNewPassword}
                onToggle={onToggleNewPassword}
                autoComplete="new-password"
              />
              <PasswordField
                id="confirm-password"
                label="Confirm new password"
                value={confirmPassword}
                onChange={onConfirmPasswordChange}
                show={showConfirmPassword}
                onToggle={onToggleConfirmPassword}
                autoComplete="new-password"
              />
              {authError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {authError}
                </p>
              ) : null}
              {infoMessage ? (
                <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
                  {infoMessage}
                </p>
              ) : null}
              <Button type="submit" className="w-full" size="lg" disabled={forgotBusy}>
                {forgotBusy ? "Updating…" : "Update password"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={onBackToSignIn}>
                <ArrowLeft className="size-4" />
                Back to sign in
              </Button>
            </form>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={onEmailChange}
                  required
                  autoComplete="email"
                />
              </div>
              <PasswordField
                id="login-password"
                label="Password"
                value={password}
                onChange={onPasswordChange}
                show={showPassword}
                onToggle={onTogglePassword}
                autoComplete="current-password"
              />
              <div className="flex justify-end">
                <Button type="button" variant="link" className="h-auto px-0 text-sm" onClick={onForgotPassword}>
                  Forgot password?
                </Button>
              </div>
              {authError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {authError}
                </p>
              ) : null}
              <Button type="submit" className="w-full" size="lg" disabled={signingIn}>
                {signingIn ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage({
  email,
  password,
  showPassword,
  authError,
  signingIn,
  onEmailChange,
  onPasswordChange,
  onTogglePassword,
  onSubmit,
  themeToggle
}) {
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
            <CardDescription>Sign in to your operations workspace</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
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
            <div className="space-y-2">
              <Label htmlFor="login-password">Password</Label>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={onPasswordChange}
                  autoComplete="current-password"
                  required
                  className="pr-16"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full rounded-l-none px-3 text-xs text-muted-foreground"
                  onClick={onTogglePassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </Button>
              </div>
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
        </CardContent>
      </Card>
    </div>
  );
}

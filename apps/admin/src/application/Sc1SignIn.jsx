// Sign-in as seen inside the installed app, following the native auth screen. The browser keeps the shared sign-in.
import { Surface, Field, Button, Notice } from "../scott-one-ui";
import mark from "../scott-one-ui/assets/mark.png";
import "./sc1SignIn.css";

export default function Sc1SignIn({ email, password, busy, error, onEmail, onPassword, onSubmit, onForgot, onRegister, onConfirm, onInvite }) {
  return <Surface as="main" skin="auth" className="sc1-signin">
    <form onSubmit={onSubmit}>
      <span className="sc1-signin-mark" role="img" aria-label="Scott One" style={{ WebkitMaskImage: `url(${mark})`, maskImage: `url(${mark})` }} />
      <div><h1 className="sc1-type-auth">Welcome back</h1><p className="sc1-muted">Continue to your Scott One account.</p></div>
      <Field variant="auth" label="Email address" type="email" autoComplete="username" required value={email} onChange={onEmail} />
      <Field variant="auth" label="Password" type="password" autoComplete="current-password" required value={password} onChange={onPassword} />
      {error && <Notice tone="error" live>{error}</Notice>}
      <Button type="submit" size="auth" loading={busy}>{busy ? "Signing in" : "Sign in"}</Button>
      <Button variant="quiet" onClick={onForgot}>Forgot password?</Button>
      <div className="sc1-signin-links">
        <Button variant="quiet" onClick={onRegister}>Create a customer account</Button>
        <Button variant="quiet" onClick={onConfirm}>Confirm your account</Button>
        <Button variant="quiet" onClick={onInvite}>Accept an invitation</Button>
      </div>
    </form>
  </Surface>;
}

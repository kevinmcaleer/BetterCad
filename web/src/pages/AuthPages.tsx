import { useState, type FormEvent } from "react";
import { Button, Dialog } from "@bettercad/ui";
import { useAccount } from "../cloud/account";
import { go } from "../cloud/route";
import { useTheme } from "../state/useTheme";
import { ThemePicker } from "../editor/ThemePicker";
import { Field, FormError, Page } from "./Page";

/**
 * Sign in, sign up, password reset and the account page (#88), on powertools-auth: the login Kev's other apps share.
 * Errors sit under the field; nothing here is a modal but Delete.
 */

/** powertools-auth's rule, shared with Kev's other apps. */
const MIN_PASSWORD = 12;

const message = (e: unknown) => (e instanceof Error ? e.message : "That didn't work.");

function Unavailable() {
  return (
    <p>
      Accounts need BetterCad&rsquo;s server, and it can&rsquo;t be reached from here. You can keep working: <a href="#/">the editor</a> saves to your disk and
      autosaves in this browser.
    </p>
  );
}

export function SignInPage({ next }: { next?: string }) {
  const { api, setAccount, available } = useAccount();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setAccount(await api.signIn(login.trim(), password));
      go(next ?? "#/library");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Sign in">
      {!available && <Unavailable />}
      <form className="bc-page-form" onSubmit={submit} noValidate>
        <Field label="Username or email" autoComplete="username" required value={login} onChange={(e) => setLogin(e.target.value)} />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error ?? undefined}
        />
        <div className="bc-page-actions">
          <Button type="submit" variant="primary" label={busy ? "Signing in…" : "Sign in"} disabled={busy || !login || !password} />
          <a href={`#/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Make an account</a>
        </div>
        <p className="bc-page-note">
          <a href="#/forgot">Forgot your password?</a>
        </p>
      </form>
    </Page>
  );
}

export function SignUpPage({ next }: { next?: string }) {
  const { api, setAccount, available } = useAccount();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; username?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username.trim())) found.username = "Use 3 to 32 letters, numbers, dots, dashes or underscores.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) found.email = "Enter an email address, like you@example.com.";
    if (password.length < MIN_PASSWORD) found.password = `Use at least ${MIN_PASSWORD} characters.`;
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      setAccount(await api.signUp(username.trim(), email.trim(), password));
      go(next ?? "#/library");
    } catch (err) {
      const text = message(err);
      setErrors(
        /username/i.test(text) ? { username: text } : /email/i.test(text) ? { email: text } : /password/i.test(text) ? { password: text } : { form: text },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Make an account">
      {!available && <Unavailable />}
      <p>An account keeps your models online, so you can open them on any computer and share a link. The editor works without one.</p>
      <form className="bc-page-form" onSubmit={submit} noValidate>
        <Field
          label="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={errors.username}
          hint="Shown on the models you share."
        />
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint={`At least ${MIN_PASSWORD} characters.`}
        />
        <FormError text={errors.form ?? null} />
        <div className="bc-page-actions">
          <Button type="submit" variant="primary" label={busy ? "Making your account…" : "Make account"} disabled={busy} />
          <a href={`#/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`}>I have an account</a>
        </div>
        <p className="bc-page-note">
          Making an account means you agree to the <a href="#/terms">terms</a>. The <a href="#/privacy">privacy page</a> says what we keep.
        </p>
      </form>
    </Page>
  );
}

export function ForgotPage() {
  const { api, available } = useAccount();
  const [login, setLogin] = useState("");
  const [state, setState] = useState<{ sent?: boolean; error?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.forgotPassword(login.trim());
      setState({ sent: true });
    } catch (err) {
      setState({ error: message(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Reset your password">
      {!available && <Unavailable />}
      {state.sent ? (
        <p role="status">If that account has an email address, a link to reset the password is on its way. It works once, for an hour.</p>
      ) : (
        <form className="bc-page-form" onSubmit={submit} noValidate>
          <Field label="Username or email" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} error={state.error} />
          <div className="bc-page-actions">
            <Button type="submit" variant="primary" label={busy ? "Sending…" : "Send a reset link"} disabled={busy || !login.trim()} />
            <a href="#/signin">Back to sign in</a>
          </div>
        </form>
      )}
    </Page>
  );
}

export function ResetPage({ token }: { token: string }) {
  const { api, setAccount } = useAccount();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    setBusy(true);
    try {
      setAccount(await api.resetPassword(token, password));
      go("#/library");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Choose a new password">
      <form className="bc-page-form" onSubmit={submit} noValidate>
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error ?? undefined}
          hint={`At least ${MIN_PASSWORD} characters. Other devices are signed out.`}
        />
        <div className="bc-page-actions">
          <Button type="submit" variant="primary" label={busy ? "Saving…" : "Save password"} disabled={busy || !password} />
          <a href="#/forgot">Send a new link</a>
        </div>
      </form>
    </Page>
  );
}

export function AccountPage() {
  const { api, account, ready, setAccount } = useAccount();
  const { theme, setTheme } = useTheme();
  const [email, setEmail] = useState(account?.email ?? "");
  const [emailPassword, setEmailPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<{ email?: string; password?: string; saved?: string }>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!ready) return <Page title="Account">{null}</Page>;
  if (!account)
    return (
      <Page title="Account">
        <p>
          <a href="#/signin?next=%23%2Faccount">Sign in</a> to see your account.
        </p>
      </Page>
    );

  const saveEmail = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setAccount(await api.changeEmail(email.trim(), emailPassword));
      setEmailPassword("");
      setNote({ saved: "Email saved" });
    } catch (err) {
      setNote({ email: message(err) });
    }
  };
  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setNote({ password: `Use at least ${MIN_PASSWORD} characters.` });
    try {
      setAccount(await api.changePassword(current, password));
      setCurrent("");
      setPassword("");
      setNote({ saved: "Password changed. Other devices are signed out." });
    } catch (err) {
      setNote({ password: message(err) });
    }
  };
  const signOut = async () => {
    await api.signOut().catch(() => undefined);
    setAccount(null);
    go("#/");
  };
  const remove = async () => {
    try {
      await api.deleteMe(typed.trim());
      setAccount(null);
      go("#/");
    } catch (err) {
      setDeleteError(message(err));
    }
  };

  return (
    <Page title="Account" bar={<Button label="My models" icon="folder" onClick={() => go("#/library")} />}>
      <p>
        Signed in as <strong>{account.username}</strong>.
      </p>
      <p role="status" className="bc-page-note">
        {note.saved ?? ""}
      </p>
      <section className="bc-page-section">
        <h2>Theme</h2>
        <ThemePicker value={theme} onChange={setTheme} />
      </section>
      <section className="bc-page-section">
        <h2>Email</h2>
        <form className="bc-page-form" onSubmit={saveEmail}>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="Password reset links go here."
          />
          <Field
            label="Password to confirm"
            type="password"
            autoComplete="current-password"
            value={emailPassword}
            onChange={(e) => setEmailPassword(e.target.value)}
            error={note.email}
          />
          <div className="bc-page-actions">
            <Button type="submit" label="Save email" disabled={!emailPassword || email.trim() === (account.email ?? "")} />
          </div>
        </form>
      </section>
      <section className="bc-page-section">
        <h2>Password</h2>
        <form className="bc-page-form" onSubmit={savePassword}>
          <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={note.password}
          />
          <div className="bc-page-actions">
            <Button type="submit" label="Change password" disabled={!current || !password} />
          </div>
        </form>
      </section>
      <section className="bc-page-section">
        <h2>Sign out or leave</h2>
        <div className="bc-page-actions">
          <Button label="Sign out" icon="user" onClick={() => void signOut()} />
          <Button variant="danger" label="Delete account…" onClick={() => setConfirmDelete(true)} />
        </div>
      </section>
      {confirmDelete && (
        <Dialog
          open
          modal
          title="Delete your account?"
          icon="trash"
          onCancel={() => setConfirmDelete(false)}
          footer={
            <>
              <Button kind="cancel" label="Cancel" onClick={() => setConfirmDelete(false)} />
              <Button
                variant="danger"
                label="Delete account"
                disabled={typed.trim().toLowerCase() !== account.username.toLowerCase()}
                onClick={() => void remove()}
              />
            </>
          }
        >
          <p>This deletes every model saved to your BetterCad account, with their versions and share links. It can&rsquo;t be undone.</p>
          <Field label="Type your username to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} error={deleteError ?? undefined} />
        </Dialog>
      )}
    </Page>
  );
}

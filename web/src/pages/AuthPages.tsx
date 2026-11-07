import { useState, type FormEvent } from "react";
import { Button, Dialog } from "@bettercad/ui";
import { ApiError } from "../cloud/api";
import { useAccount } from "../cloud/account";
import { go } from "../cloud/route";
import { useTheme } from "../state/useTheme";
import { ThemePicker } from "../editor/ThemePicker";
import { Field, FormError, Page } from "./Page";

/** Sign in, sign up and the account page (#88). Errors sit under the field; nothing here is a modal but Delete. */

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setAccount(await api.signIn(email, password));
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
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
          <Button type="submit" variant="primary" label={busy ? "Signing in…" : "Sign in"} disabled={busy || !email || !password} />
          <a href={`#/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Make an account</a>
        </div>
        <p className="bc-page-note">Forgot your password? Ask Kev to reset it for now; email resets come later.</p>
      </form>
    </Page>
  );
}

export function SignUpPage({ next }: { next?: string }) {
  const { api, setAccount, available } = useAccount();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; name?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) found.email = "Enter an email address, like you@example.com.";
    if (!name.trim()) found.name = "Enter the name to show on your models.";
    if (password.length < 8) found.password = "Use at least 8 characters.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      setAccount(await api.signUp(email.trim(), name.trim(), password));
      go(next ?? "#/library");
    } catch (err) {
      setErrors(err instanceof ApiError && err.status === 409 ? { email: err.message } : { form: message(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Make an account">
      {!available && <Unavailable />}
      <p>An account keeps your models online, so you can open them on any computer and share a link. The editor works without one.</p>
      <form className="bc-page-form" onSubmit={submit} noValidate>
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <Field label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint="At least 8 characters."
        />
        <FormError text={errors.form ?? null} />
        <div className="bc-page-actions">
          <Button type="submit" variant="primary" label={busy ? "Making your account…" : "Make account"} disabled={busy} />
          <a href={`#/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`}>I have an account</a>
        </div>
      </form>
    </Page>
  );
}

export function AccountPage() {
  const { api, account, ready, setAccount } = useAccount();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(account?.name ?? "");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<{ name?: string; password?: string; saved?: string }>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!ready) return <Page title="Account">{null}</Page>;
  if (!account)
    return (
      <Page title="Account">
        <p>
          <a href="#/signin?next=%23%2Faccount">Sign in</a> to see your account.
        </p>
      </Page>
    );

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setNote({ name: "Enter a name." });
    try {
      setAccount(await api.updateMe({ name: name.trim() }));
      setNote({ saved: "Name saved" });
    } catch (err) {
      setNote({ name: message(err) });
    }
  };
  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setNote({ password: "Use at least 8 characters." });
    try {
      setAccount(await api.updateMe({ password, current_password: current }));
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
      await api.deleteMe();
      setAccount(null);
      go("#/");
    } catch (err) {
      setConfirmDelete(false);
      setNote({ saved: message(err) });
    }
  };

  return (
    <Page title="Account" bar={<Button label="My models" icon="folder" onClick={() => go("#/library")} />}>
      <p>
        Signed in as <strong>{account.email}</strong>.
      </p>
      <p role="status" className="bc-page-note">
        {note.saved ?? ""}
      </p>
      <form className="bc-page-form" onSubmit={saveName}>
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} error={note.name} autoComplete="name" />
        <div className="bc-page-actions">
          <Button type="submit" label="Save name" disabled={name.trim() === account.name} />
        </div>
      </form>
      <section className="bc-page-section">
        <h2>Theme</h2>
        <ThemePicker value={theme} onChange={setTheme} />
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
              <Button variant="danger" label="Delete account" onClick={() => void remove()} />
            </>
          }
        >
          <p>This deletes your account and every model saved to it, with their versions and share links. It can&rsquo;t be undone.</p>
        </Dialog>
      )}
    </Page>
  );
}

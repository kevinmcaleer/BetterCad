import { useEffect, useState } from "react";
import { Button, Dialog } from "@bettercad/ui";
import type { AuthLinks } from "../cloud/api";
import { useAccount } from "../cloud/account";
import { go } from "../cloud/route";
import { useTheme } from "../state/useTheme";
import { ThemePicker } from "../editor/ThemePicker";
import { Field, FormError, Page } from "./Page";

/**
 * Sign in and the account page (#88). You sign in with your kevsrobots.com account: signing in, making an account and
 * resetting a password happen on kevsrobots.com, which sends you back here. Nothing here is a modal but Delete.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : "That didn't work.");

function Unavailable() {
  return (
    <p>
      Accounts need BetterCad&rsquo;s server, and it can&rsquo;t be reached from here. You can keep working: <a href="#/">the editor</a> saves to your disk and
      autosaves in this browser.
    </p>
  );
}

/** kevsrobots.com's sign-in links for coming back to `next`, or an error to show. */
function useLinks(next: string) {
  const { api, available } = useAccount();
  const [links, setLinks] = useState<AuthLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!available) return;
    let live = true;
    api.links(next).then(
      (l) => live && setLinks(l),
      (e) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [api, next, available]);
  return { links, error: error ?? links?.problem ?? null };
}

function KevsrobotsSignIn({ next, signUp }: { next?: string; signUp?: boolean }) {
  const { account, available } = useAccount();
  const { links, error } = useLinks(next ?? "#/library");

  // Back from kevsrobots.com already signed in: carry on.
  useEffect(() => {
    if (account) go(next ?? "#/library");
  }, [account, next]);

  return (
    <Page title={signUp ? "Make an account" : "Sign in"}>
      {!available && <Unavailable />}
      <p>
        BetterCad uses your kevsrobots.com account. {signUp ? "Make one there" : "Sign in there"}, and you come back here with your models saved online, so you
        can open them on any computer and share a link. The editor works without one.
      </p>
      <FormError text={error} />
      <div className="bc-page-actions">
        {signUp ? (
          <Button
            variant="primary"
            label="Make an account on kevsrobots.com"
            disabled={!links}
            onClick={() => links && window.location.assign(links.signup_url)}
          />
        ) : (
          <Button variant="primary" label="Sign in with kevsrobots.com" disabled={!links} onClick={() => links && window.location.assign(links.signin_url)} />
        )}
        {signUp ? (
          <a href={`#/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`}>I have an account</a>
        ) : (
          <a href={`#/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Make an account</a>
        )}
      </div>
      <p className="bc-page-note">
        One account works across kevsrobots.com. Making one means you agree to BetterCad&rsquo;s <a href="#/terms">terms</a>, and the{" "}
        <a href="#/privacy">privacy page</a> says what BetterCad keeps.
      </p>
    </Page>
  );
}

export function SignInPage({ next }: { next?: string }) {
  return <KevsrobotsSignIn next={next} />;
}

export function SignUpPage({ next }: { next?: string }) {
  return <KevsrobotsSignIn next={next} signUp />;
}

export function AccountPage() {
  const { api, account, ready, setAccount } = useAccount();
  const { theme, setTheme } = useTheme();
  const { links } = useLinks("#/account");
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

  const signOut = async () => {
    await api.signOut().catch(() => undefined);
    setAccount(null);
    go("#/");
  };
  const remove = async () => {
    try {
      await api.deleteMe(typed.trim());
      setConfirmDelete(false);
      setTyped("");
      // Still signed in to kevsrobots.com: BetterCad starts again with an empty account.
      setAccount(await api.me());
      go("#/library");
    } catch (err) {
      setDeleteError(message(err));
    }
  };

  return (
    <Page title="Account" bar={<Button label="My models" icon="folder" onClick={() => go("#/library")} />}>
      <p>
        Signed in to kevsrobots.com as <strong>{account.username}</strong>
        {account.email ? <> ({account.email})</> : null}.
      </p>
      <section className="bc-page-section">
        <h2>Theme</h2>
        <ThemePicker value={theme} onChange={setTheme} />
      </section>
      <section className="bc-page-section">
        <h2>Your kevsrobots.com account</h2>
        <p>Your name, email and password are kept by kevsrobots.com.</p>
        <div className="bc-page-actions">
          <Button label="Manage it on kevsrobots.com" disabled={!links} onClick={() => links && window.location.assign(links.account_url)} />
        </div>
      </section>
      <section className="bc-page-section">
        <h2>Sign out or leave</h2>
        <div className="bc-page-actions">
          <Button label="Sign out" icon="user" onClick={() => void signOut()} />
          <Button variant="danger" label="Delete my BetterCad models…" onClick={() => setConfirmDelete(true)} />
        </div>
      </section>
      {confirmDelete && (
        <Dialog
          open
          modal
          title="Delete your BetterCad models?"
          icon="trash"
          onCancel={() => setConfirmDelete(false)}
          footer={
            <>
              <Button kind="cancel" label="Cancel" onClick={() => setConfirmDelete(false)} />
              <Button
                variant="danger"
                label="Delete models"
                disabled={typed.trim().toLowerCase() !== account.username.toLowerCase()}
                onClick={() => void remove()}
              />
            </>
          }
        >
          <p>
            This deletes every model saved to BetterCad, with their versions and share links, and your settings here. It can&rsquo;t be undone. Your
            kevsrobots.com account stays.
          </p>
          <Field label="Type your username to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} error={deleteError ?? undefined} />
        </Dialog>
      )}
    </Page>
  );
}

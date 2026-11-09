import { Page } from "./Page";

const ISSUES = "https://github.com/kevinmcaleer/BetterCad/issues";

/** #/privacy (#111): what BetterCad keeps, in plain words. Kev reviews this text before launch. */
export function PrivacyPage() {
  return (
    <Page title="Privacy">
      <p>BetterCad keeps as little about you as it can. Here is all of it.</p>

      <h2>Without an account</h2>
      <p>
        The editor runs in your browser. Your models, settings and recent files stay on your computer, in your browser&rsquo;s storage, and are never sent to
        us.
      </p>

      <h2>With an account</h2>
      <p>
        We keep your email address, your name, your password (hashed, never readable), your theme, the day you last used BetterCad, and the models you save to
        your account with their versions, thumbnails and share links. A cookie keeps you signed in; it is the only cookie BetterCad sets. Delete your account on
        the Account page and all of it goes straight away.
      </p>

      <h2>Problem reports</h2>
      <p>
        When you press Send in Report a problem, we keep what the dialog showed you: your note, your browser and version, the last error, your last 20 edits
        (their types only) and, if you ticked it, your model. Kev reads them to fix the problem and deletes them when it is fixed. Nothing is sent until you
        press Send.
      </p>

      <h2>Page counts</h2>
      <p>
        Once per visit, the app tells the server which page you opened, and the server adds one to that page&rsquo;s count for the day. Nothing else is stored
        with it: no cookie, no IP address, no browser details, no account.
      </p>

      <h2>What we never do</h2>
      <p>No third-party analytics, no advertising, no tracking pixels, and we never sell or share your data.</p>

      <p className="bc-page-note">
        Questions? Open an issue on <a href={ISSUES}>GitHub</a>. See also the <a href="#/terms">terms</a>.
      </p>
    </Page>
  );
}

/** #/terms (#111): short terms. Kev reviews this text before launch. */
export function TermsPage() {
  return (
    <Page title="Terms">
      <p>BetterCad is free, open-source software made by Kevin McAleer. By using it you agree to these terms.</p>

      <h2>Your models are yours</h2>
      <p>You own what you make. We store models you save to your account only to give them back to you, and to whoever you send a share link to.</p>

      <h2>Use it fairly</h2>
      <p>Don&rsquo;t use the service to store or share anything illegal, and don&rsquo;t try to break it or overload it for others.</p>

      <h2>No warranty</h2>
      <p>
        BetterCad comes as it is, without a warranty, under the MIT licence. Check a part&rsquo;s sizes before you print something that matters, and keep your
        own copies of models you care about: download a .bcad from the Save menu.
      </p>

      <h2>Accounts</h2>
      <p>
        You can delete your account at any time. We may remove an account that breaks these terms. If the service ever closes, we will give notice so you can
        download your models first.
      </p>

      <p className="bc-page-note">
        See the <a href="#/privacy">privacy page</a> for what we keep. Questions? Open an issue on <a href={ISSUES}>GitHub</a>.
      </p>
    </Page>
  );
}

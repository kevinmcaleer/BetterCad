# Accounts and the cloud

Epic #9. The editor never needs an account: everything in [files.md](files.md) works signed out and offline. An
account adds a library of models on the server, versions and share links.

## Pages

Hash routes, so the same build runs on any static host:

| Route | Page |
| --- | --- |
| `#/` | The editor |
| `#/edit/<id>` | The editor with a model from your account |
| `#/signin`, `#/signup` | Sign in, make an account (`?next=` says where to go after) |
| `#/forgot`, `#/reset-password` | Ask for a reset email, and the page its link opens |
| `#/account` | Theme, email, password, sign out, delete the account |
| `#/library`, `#/library/bin` | My models, and the 30-day bin |

The editor stays mounted under a page, so going to the library and back keeps the open model and its undo history.
When `/api` doesn't answer with JSON (GitHub Pages, `vite preview`, offline), the account menu says accounts can't be
reached and nothing else changes.

## Saving to the account

- **Save to your account…** in the Save menu asks for a name the first time; the address becomes `#/edit/<id>`.
- After that **Ctrl+S** saves a new version to the account; **Save a copy to disk** is in the Save menu.
- While there are changes, the model saves itself every 30 seconds as a version noted "autosave". The local autosave
  (#84) keeps running underneath, so a failed cloud save loses nothing.
- Each save sends `If-Match: <version>`. If another tab or computer saved first, a dialog offers **Save anyway**
  (yours becomes the newest version; theirs stays in the history) or **Reload**.
- Imported files (#82) upload once each to `/api/blobs/<hash>`; the stored `.bcad` lists them by hash with empty
  contents, and opening the model fetches them back (`web/src/cloud/cloudDoc.ts`).
- The cloud icon beside the name shows the state: saved, saving, changes waiting, offline, or not saved. Click it to
  save now.

## Versions

Every save to the account is a version. The cloud icon beside the name opens **Version history**: newest first,
with time, size and note, and runs of autosaves folded into one row. **View** shows an old version read-only (the
store is locked: edits, undo and redo stop with a note) under a bar with **Restore** and **Back**. Restore saves it
again as the newest version, noted "Restored version N", so nothing is lost. The current version can carry a note.
The server keeps every version for 30 days, then the newest 10 older ones and any a share link shows.

## Share links

**Share** in the top bar (for a model in your account) makes a link, `https://<host>/view/<token>`. The server
answers that address with Open Graph tags (name, owner, thumbnail) so a pasted link previews in Discord and Slack, and
sends the browser to `#/view/<token>`. There the model opens read-only, rebuilt in the visitor's browser from its
recipe: the parts tree, views, measure, **Download** (STL, 3MF, STEP or `.bcad`) and **Open a copy**, which makes
it a new unsaved model of the visitor's own. **Turn off the link** in the Share dialog stops it; the viewer then says
the link isn't active. `frame-ancestors` lets kevsrobots.com frame the viewer (#93).

## Sign-in

Sign-in is [powertools-auth](https://github.com/kevinmcaleer/markdown-studio/tree/main/packages/powertools-auth), the
login Kev's other apps use (#88), pinned to a commit in `server/pyproject.toml`. It owns the `users`, `sessions` and
`password_resets` tables and serves `/api/auth/*`: argon2id passwords (12 characters or more), server-side sessions
stored hashed, an HttpOnly SameSite=Lax cookie (Secure in production), a CSRF token on every change, and 10 sign-in
tries per 15 minutes from one address. Forgot password emails a one-time link when `SMTP_HOST` and `PUBLIC_URL` are
set; the link opens `#/reset-password#token=…`.

`server/bettercad/auth.py` adds what only BetterCad needs:

- `accounts`, one row per person who has used BetterCad, keyed by their user id. It holds the theme and the name shown
  on share links; models, files and printer profiles hang off it.
- Sign-in with a username or an email address. Accounts from the old stand-in login were moved over with the same ids
  and a username from their email; their scrypt password turns into argon2id the first time they sign in.
- `/api/account`: read it, change the theme, or delete your BetterCad data (type your username to confirm).

### One login across Kev's apps

Sharing needs three things, all set in `.env`:

| Setting | Value |
| --- | --- |
| `AUTH_DATABASE_PATH` | The SQLite file that holds the suite's users, the same file the other apps open. It must be on a local disk of the machine BetterCad runs on (never NFS or SMB). |
| `COOKIE_DOMAIN` | The parent domain all the apps sit under, such as `.kevsrobots.com`. A cookie can't cross from one domain to another, so every app must be a subdomain of it. |
| `COOKIE_PREFIX` | The other apps' cookie prefix (Markdown Studio uses `ms`), so a session started in one app is a session here. |

With them set, BetterCad's own tables stay in `bettercad.db` and only the auth tables live in the shared file.
Deleting your account here then deletes only your BetterCad data; the login stays for the other apps. Whichever app
opens the shared file first creates the auth tables; they are recorded in `schema_migrations` as markdown-studio does.
The server refuses to start if its accounts were made against a different users database, so models can't change
hands.

Your theme is saved to your account and applied when you sign in.

## Tests

`web/e2e/fakeApi.ts` answers `/api` inside Playwright from memory, following `server/bettercad/models.py`;
`web/e2e/cloud.spec.ts` covers sign up and in, the library, saving and reopening, and the two-tab conflict. The real
server's tests are in `server/tests`.

# Accounts and the cloud

Epic #9. The editor never needs an account: everything in [files.md](files.md) works signed out and offline. An
account adds a library of models on the server, versions and share links.

## Pages

Hash routes, so the same build runs on any static host:

| Route | Page |
| --- | --- |
| `#/` | The editor |
| `#/edit/<id>` | The editor with a model from your account |
| `#/signin`, `#/signup` | Sign in or make an account on kevsrobots.com (`?next=` says where to come back to) |
| `#/account` | Theme, a link to your kevsrobots.com account, sign out, delete your BetterCad models |
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

You sign in with your kevsrobots.com account (#88). Those accounts live in
[Chatter](https://github.com/kevinmcaleer/Chatter) at `chatter.kevsrobots.com`; BetterCad never sees a password.

- **Sign in** and **Make an account** send you to Chatter's login and register pages with `return_to` set to the page
  you came from on `bettercad.kevsrobots.com`. Password resets and profile changes happen there too.
- Signing in there sets an HttpOnly `access_token` cookie on `.kevsrobots.com`, so the browser sends it to BetterCad.
  `server/bettercad/auth.py` asks Chatter who it belongs to (`GET /accounts/me`, remembered for a minute). If Chatter
  can't be reached, the API answers 503 rather than signing you out.
- BetterCad keeps `accounts`, one row per person, keyed by their kevsrobots.com user id: the theme and the name shown
  on share links. Models, files and printer profiles hang off it.
- Changes carry a CSRF token, an HMAC of the cookie with BetterCad's `SECRET_KEY`, from `/api/auth/session`.
- **Sign out** clears the cookie, which signs you out of every kevsrobots.com app. **Delete my BetterCad models**
  deletes only BetterCad's data; the kevsrobots.com account stays.

Settings: `CHATTER_URL` (default `https://chatter.kevsrobots.com`), `COOKIE_DOMAIN` (`.kevsrobots.com` in
docker-compose) and `PUBLIC_URL`. The cookie only reaches BetterCad when it is served under kevsrobots.com.

Your theme is saved to your account and applied when you sign in.

## Tests

`web/e2e/fakeApi.ts` answers `/api` inside Playwright from memory, following `server/bettercad/models.py`;
`web/e2e/cloud.spec.ts` covers sign up and in, the library, saving and reopening, and the two-tab conflict. The real
server's tests are in `server/tests`.

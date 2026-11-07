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
| `#/account` | Name, theme, password, sign out, delete the account |
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

## Sign-in

`server/bettercad/auth.py` is a small stand-in for markdown-studio's powertools-auth (#88): scrypt passwords,
server-side sessions, an HttpOnly SameSite=Lax cookie (Secure in production), a CSRF token on every change and 10
failed sign-ins per 15 minutes per address and account. Whether BetterCad shares the kevsrobots login is still to
decide; swapping the module keeps the `CurrentUser` and `Writer` dependencies the API uses.

Your theme is saved to your account and applied when you sign in.

## Tests

`web/e2e/fakeApi.ts` answers `/api` inside Playwright from memory, following `server/bettercad/models.py`;
`web/e2e/cloud.spec.ts` covers sign up and in, the library, saving and reopening, and the two-tab conflict. The real
server's tests are in `server/tests`.

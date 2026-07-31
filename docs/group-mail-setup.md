# Group Mail — one-time setup (owner)

The module lives at **Admin → Users → Group Mail** (owner-only). It manages the
Namecheap/cPanel mailing lists (e.g. `circulation@arabshipbroker.com`) and
sends branded circulars — test first, then broadcast. Three credentials make
it work, all stored encrypted in Supabase Vault:

## 1 · cPanel API token (list create/delete/config)

1. Log in to cPanel (`https://server353-4.web-hosting.com:2083`).
2. **Security → Manage API Tokens → Create** — name it `asb-group-mail`,
   no expiry (or yearly), **Create**.
3. Copy the token once (it is never shown again) and paste it in
   **Group Mail → Settings → cPanel** together with:
   - cPanel host: `server353-4.web-hosting.com`
   - cPanel username: your hosting account username (the one you log in with)
4. Press **Test cPanel connection** — it should report the number of lists.

## 2 · List admin password (member management)

Member add/edit/remove drives the list's own Mailman admin. For each list,
the module needs that list's **admin password** (set when the list was created
in cPanel; resettable in cPanel → Mailing Lists → Change Password, or from the
module's **Config** drawer).

Open **Mailing Lists → Members** on the list — the panel asks for the password
once and stores it in the Vault. Lists created *inside* the module store it
automatically.

If loading members fails with a "base URL" error, set **Mailman base URL** in
Settings to `https://server353-4.web-hosting.com/mailman` (the domain itself
points at Vercel, so Mailman is reached through the hosting server).

## 3 · SMTP mailbox (the From address)

Circulars are sent through a real mailbox on the hosting (recommended:
`circulation@arabshipbroker.com`'s posting address is the list itself, so use a
desk mailbox such as `circ@arabshipbroker.com`):

- SMTP host `server353-4.web-hosting.com`, port `465` (SSL) — verified working.
- Mailbox = full address; password = the mailbox password from
  cPanel → Email Accounts.
- Press **Test SMTP login**.

## Sending flow

1. **Compose** — pick the list, subject, body (blank line = new paragraph),
   optional links (become buttons). **Preview** shows the exact branded mail
   (same template family as the contact-form notification).
2. **Send test** — goes only to the test addresses (default list in Settings).
3. **Broadcast to list** — sends an individual branded email to every Mailman
   member (not through Mailman's posting pipeline, so no moderation holds and
   each failure is recorded per address). Progress is shown live; results land
   in **History**.

## Notes

- Broadcasts run in batches of 10 with a small pause — shared-hosting friendly.
  Namecheap caps outgoing mail per hour; very large lists may need a second run.
- Deleting a list in the module deletes it on the server (cPanel) — that is not
  undoable, so the module asks twice.
- Secrets never reach the browser: the UI only ever shows "stored in Vault".

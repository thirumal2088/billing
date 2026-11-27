Rainbow Sports Billing — shared online version (Netlify)

All PCs and mobile phones open the same site address and work on one shared
Netlify Database (Postgres). Bills, invoice numbers, payments, customers,
production stages, rack status, attachments, shop details and dashboard totals
are the same on every device. Other devices pick up changes within about 15
seconds, and right away when you switch tabs or reopen the app.

How it is built
- index.html — the billing app (same design and features as before).
- netlify/functions/api.mts — secure server API at /api/* (login, bills,
  import, attachments, shop settings).
- netlify/database/migrations — database tables, applied automatically on deploy.
- Attachment files (designs, voice notes, Excel) are stored in Netlify Blobs.

First-time setup
1. In Netlify project settings, set the environment variable RAINBOW_SETUP_KEY
   to a private value of at least 8 characters. Redeploy.
2. Open the site. The first screen asks for the setup key, your name, mobile
   number and password. This creates the owner (admin) login. It works only
   once.
3. Settings / Backup → Staff Logins: add each staff member with their mobile
   number and a password. Admins can reset passwords and disable logins.

Security
- Passwords are stored as scrypt hashes, never as plain text.
- Logins use a secure HttpOnly cookie that expires after 30 days. Five wrong
  passwords lock that mobile number for 15 minutes.
- The server issues every invoice number (RS-0001 for orders, DS-0001 for
  direct sales), so two devices never get the same number.
- The server rejects a second order on a rack that is already occupied, and
  existing payment entries can never be removed.
- If two staff members change the same bill at once, the second save is
  refused and the latest copy is loaded instead of silently overwriting.

Bringing in existing bills
Nothing stored in a browser is deleted. On each PC or phone that has old bills:
- Settings / Backup → "Import bills saved in this browser" uploads that
  browser's bills, its attachments and its shop details, or
- "Import JSON Backup (safe)" uploads a downloaded backup file.
A summary is shown before anything is added. Bills already in the shared
database are skipped, so running an import twice is safe. If a different bill
already uses the same invoice number, it is skipped unless you tick the option
to import it with a new number (the old number is kept on the bill).

Deploy previews use their own copy of the database. Bills entered in a preview
do not appear in production.

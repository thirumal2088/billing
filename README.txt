Rainbow Sports — Shared Mobile Billing

This package requires Python 3.10+, SQLite storage on a persistent disk
and an HTTPS reverse proxy. Serve index.html and /api/bills at the same
origin. A static-only Netlify upload cannot run this Python server.

Keep a backup of each device's browser bills before switching. On the
server, set RAINBOW_DB to the persistent SQLite path. To bring in old
data, repeat this command with each private JSON backup:

    python3 server.py --import-backup /secure/path/billing-backup.json

Import skips existing bill IDs and retains original invoice numbers.
Back up an existing database before running an import. The database
holds bill details, villages, payments, diary and production states.
Attachments and shop settings remain in the device's browser.

Configure RAINBOW_STAFF as a JSON object of staff usernames and strong
passwords in the server environment. Keep credentials out of source
control. Start the service:

    python3 server.py

The default bind is 127.0.0.1:8080. Put the HTTPS reverse proxy in front
of it and preserve the Authorization header. Staff sign in using their
individual credentials. All staff see the same dashboard, which checks
for changes every four seconds. New invoice numbers are issued by the
server and reset monthly in Indian time.

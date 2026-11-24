RAINBOW SPORTS SHARED BILLING

Use one HTTPS address for all billing admins. The same server serves both
the dashboard and the billing API. Each admin signs in with their own
username and password. They see the same bills, balances, production and
rack status. Open a bill by tapping its invoice or customer label.
Swipe the list horizontally to see the remaining columns.

SERVER SETUP
1. Extract this package onto an always-on host with Python 3.10 or newer.
2. Set RAINBOW_DB to a private SQLite path on persistent storage.
3. Set the RAINBOW_STAFF environment variable to a JSON object mapping
   each admin username to a unique strong password. Example shape:
   {"admin-name":"<replace with a unique strong password>"}.
4. Run python3 server.py. The default bind is 127.0.0.1:8080.
   Run it under your host's process manager so it restarts automatically.
5. Route the billing HTTPS domain to that process through a reverse proxy
   and preserve the Authorization header. Use the same HTTPS address
   on every phone. A static Netlify upload cannot run this Python server.
6. After verifying the new address with two logins, share that same address
   with the billing admins and update any old dashboard bookmarks.

EXISTING BILLS
Download a JSON backup from Settings on each browser that contains bills.
Keep those files private. Take a backup of an existing SQLite database
before importing. With the same RAINBOW_DB environment setting, run:
    python3 server.py --import-backup /private/path/to/backup.json

Repeat for each device backup. Import keeps invoice numbers and skips bill IDs
that are already present. If different phones reused the same invoice number
for different bills, those records retain separate IDs and original numbers.
New invoice numbers are issued centrally. Dashboard changes are checked
every four seconds while open.

Invoice preview uses the supplied Rainbow Sports artwork and fixed BharatPe
QR. Print/PDF and WhatsApp are available from preview. Browser-local design,
voice and Excel attachments and shop settings are outside the shared database.

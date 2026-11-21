Rainbow Sports shared billing

Requires Python 3.10+ and a server with persistent disk. Run this app behind
an HTTPS reverse proxy. Serve the HTML and /api/bills from the same origin.
Static-only Netlify hosting cannot run this Python server.

1. Extract the package with its assets folder. The included payment QR was
   generated using the BharatPe UPI ID from the original billing HTML.
   Customers enter the amount in their UPI app.
2. Before replacing the old site, download the existing Billing JSON Backup
   from each browser that has bills. Keep those files privately.
3. Set RAINBOW_DB to a writable, persistent database path. Import old backups
   before opening the shared app to staff:
       python3 server.py --import-backup /secure/path/billing-backup.json
   Reuse the same database for each import. Repeated bill IDs are skipped.
   Previously printed invoice numbers are preserved, including any duplicates
   inherited from separate browsers. New invoices use one shared sequence.
4. Configure RAINBOW_STAFF in the server environment as a JSON object mapping
   staff usernames to individual strong passwords. Keep it out of source
   control. Run:
       python3 server.py
   The server listens on 127.0.0.1:8080 by default. Point the HTTPS reverse
   proxy at that address and preserve the Authorization header.
5. Open the same HTTPS site on both staff devices and sign in. Saving assigns
   a bill number. Bill History refreshes about every four seconds. Team Order,
   Single Order, Direct Delivery and Outlet Sale are in the Order Type menu.

The existing Direct Sale screen remains available. Outlet Sale and Direct
Delivery are order categories. Files and voice notes remain browser-local.
Back up the database using SQLite's backup command or a consistent snapshot.

Payment breakdown
Enter Cash, UPI, Bank or Other amounts together on one bill. Credit / Balance
Due is calculated from the unpaid amount. Use + Payment in Bill History to
collect credit later using one or more methods. Previous payments are retained.
The invoice, Bill History and CSV show the split across payment methods.

Payment receipts
Enter the payer's name whenever recording a payment. Each saved collection
has its own date and receipt number. Split payment methods recorded together
appear on the same receipt. Use Bill History > Receipts > Print Mini Receipt
to print or save a single payment slip. For thermal printing, choose the roll
width in the system print dialog. Older payments keep their saved dates and
amounts and show "Not recorded" if there is no payer name.

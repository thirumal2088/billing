Rainbow Sports Billing — Invoice Preview & WhatsApp update

For manual deploy, extract the ZIP and upload the folder containing index.html and assets to your existing Netlify site. For a Git-connected site, keep index.html and netlify.toml at the repository root, leave the build command blank, and use "." as the publish directory.

New:
- Preview Bill opens a full invoice overlay before printing.
- Print/PDF opens paper-size options from preview.
- WhatsApp opens customer chat with a prefilled invoice summary.
- Save Bill opens invoice preview.
- Bill History includes Preview and WhatsApp actions.

Important: WhatsApp does NOT automatically send messages or attach invoice PDF. Use Print / PDF, save the file, and attach it manually in WhatsApp. The customer number must be valid. Data is stored in browser localStorage and attachments in IndexedDB; backup before replacing deployment.

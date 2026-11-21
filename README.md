Rainbow Sports Billing — Invoice Preview & WhatsApp update

For a Git-connected Netlify site, use the repository root as the base directory. The root netlify.toml sets the build command to node scripts/build-netlify.mjs and publishes dist/client. For a manual deploy, run the same command locally and upload the generated dist/client folder. This serves the browser-local billing app. See README.txt for the separate Python shared-billing setup.

New:
- Preview Bill opens a full invoice overlay before printing.
- Print/PDF opens paper-size options from preview.
- WhatsApp opens customer chat with a prefilled invoice summary.
- Save Bill opens invoice preview.
- Bill History includes Preview and WhatsApp actions.

Important: WhatsApp does NOT automatically send messages or attach invoice PDF. Use Print / PDF, save the file, and attach it manually in WhatsApp. The customer number must be valid. Data is stored in browser localStorage and attachments in IndexedDB; backup before replacing deployment.

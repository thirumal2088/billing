# Rainbow Sports Offline Billing — Netlify-ready

This package contains the saved `Rainbow_Billing.html` version renamed to `index.html` for static hosting.

## Deploy to GitHub and Netlify
1. Create a new GitHub repository.
2. Upload `index.html`, `netlify.toml`, and `README.md` to the repository root.
3. In Netlify choose **Add new project → Import an existing project → GitHub** and select the repository.
4. Set **Build command** to blank and **Publish directory** to `.` then deploy.

Alternatively, drag the unzipped folder into Netlify's manual deploy interface.

## Important limitations
- This is a browser-local offline billing demo, not a multi-user server/database ERP.
- Bills and other data saved in browser storage are device/browser specific and are not synchronized across devices.
- Clearing browser storage can delete saved records. Use the app's **Download Backup** function regularly.
- A public Netlify URL does not add authentication or secure customer-data storage. Do not treat it as a secure production ERP without further development.

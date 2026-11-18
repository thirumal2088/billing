# Rainbow Sports Billing — GitHub + Netlify static deployment

Upload **index.html**, **netlify.toml**, and the **assets** folder to the root of a GitHub repository. In Netlify choose **Import existing project → GitHub**, select the repository, leave **Build command** blank and set **Publish directory** to `.`. This avoids the old `dist/client` missing-folder error. If Netlify has old UI settings, clear the build command and update the publish directory.

## Features
- Customer orders (RS-0001…) and separate Direct Sales (DS-0001…)
- Order statuses move directly between Pending, Packing Completed, Ready in Rack, Courier / Bus, and Delivered
- Full payment, partial credit and later payments; separate Credit List
- Bill History, filters, editing, printing, JSON backup/restore
- Fixed original BharatPe QR image and amount-based UPI QR, locked UPI ID
- Printable Rainbow Sports tax invoice with GST summary

## Important limitations
This is a **single-browser localStorage demo**. Netlify hosting does not create a shared database or user accounts. Bills entered on one device will not appear on another. Back up regularly. Amount QR requires internet access for the QRCode JavaScript library. UPI amount QR support and payee details must be verified with a small test transaction. The QR does not verify payments automatically. Tax rates and GST treatment must be verified by the business. The printed invoice is a functional HTML recreation, not a pixel-identical copy of the supplied reference image. The supplied reference is retained in `assets/invoice-reference.jpg`.

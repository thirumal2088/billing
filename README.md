# Rainbow Sports Billing — invoice reference layout

Deploy on Netlify as a static site: build command blank; publish directory `.`. GitHub: upload these four files at repository root.

The supplied invoice image is used as the exact print background. Printing is A4 landscape (to preserve reference proportions); enable background graphics in print dialog. Customer, dates, invoice number, first four items and amounts are overlaid. HSN/SAC and order fields remain blank; the current app does not collect them. GST is calculated from per-item rates and GST percentages, split equally into CGST and SGST; verify applicable tax treatment. This is an offline localStorage app, not a shared online database.

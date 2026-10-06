# Silo Grain Tracker · Balter Brewing

Forecasts when to book pale and wheat malt deliveries from the ST26 brewing schedule and your silo estimates. One Cloudflare Worker: password gate, shared storage, and the static site.

## Put it online (Cloudflare Worker + GitHub)

This project is a single Cloudflare **Worker**: `src/worker.js` handles the password and shared storage, and serves the website files from `public/`. `wrangler.jsonc` tells Cloudflare exactly what to upload (only `public/`), so nothing else in the repo is published.

1. **GitHub.** Use a **private** repository. Replace the repo's contents with this folder (delete any old `functions/` folder and old root-level `index.html`, `css/`, `js/`, `data/`). Do **not** upload `ST_26.xlsx` (`.gitignore` blocks it).
2. **Cloudflare.** Workers & Pages > your `silotracker` Worker > Settings > Builds. Build command: *(empty)*. Deploy command: `npx wrangler deploy`.
3. **Password.** Worker > Settings > Variables and secrets > add two entries with type **Secret**:
   - `SITE_PASSWORD` the password you and the crew will type
   - `AUTH_SECRET` a long random string (30+ characters). Never share it.
4. **Shared storage.** The `SILO_KV` binding is already declared in `wrangler.jsonc` (namespace id `88ed2d97ef054c26a6c68f5d602be00b`). If you ever create a different namespace, change the id there.
5. Push a commit (or Deployments > Retry). Open the Worker's `*.workers.dev` address and sign in.

Without the KV binding the site still works, but entries stay on one device (the header shows "Saved on this device only").

If you want to use your own domain, add it under Worker > Settings > Domains & Routes, then set `"workers_dev": false` in `wrangler.jsonc`.

Recommended: Cloudflare dashboard > Security > WAF > Rate limiting rule on path `/_auth/login` (e.g. 10 requests per minute per IP) to block password guessing.

## Silo history tab

Plots every silo estimate on record: the full history in ST26's Bulk Demand sheet (about a year) plus anything entered on the site. Choose 4 weeks, 12 weeks, 6 months or all time, and view by supply group (with the forecast continuing from today, deliveries marked) or each silo on one chart. A table lists every estimate, and **Download CSV** exports them. Estimates typed on the site appear as "Entered here"; once the radars are fitted, switch the source to Radar when saving and those points are drawn solid.

## Weekly routine

- **Upload the latest ST26** (drop the `.xlsx` on the "Latest ST26" card, or use the button top right). It's read in your browser, not sent anywhere. The site picks up:
  - the **brewing schedule** and **recipes** (silo grain per brew),
  - your **latest silo estimates** (the Silo 1 Volume, Silo 2 / Silo 3 Adjusted Volume and Silo 4 Volume lines on Bulk Demand), and
  - the **deliveries** you've typed on the Silo 1 DME Refill, Silo 2+3 Krones and Silo 4 Wheat Krones Refill lines, with PO numbers.
- The site counts those deliveries and only suggests extra ones on top. It also warns if a booked delivery would take a silo over the 28 t working limit.
- You can still type a fresh estimate or add a delivery directly on the site. A later ST26 upload replaces ST26-sourced deliveries and any hand-entered delivery on the same silo and day.
- The first time anyone opens the site it starts from the ST26 that was bundled with it. To refresh that bundled copy instead: `npm install`, then `npm run build-data -- path/to/ST_26.xlsx`, and commit `public/data/st26.json`.

## How the grain forecast works

- Silo grain per brew comes from **Recipes 1** (the "Barrett Burston Pale Malt Silo" and "Wheat Malt Silo" lines). Brews come from the date columns on **Bulk Demand** (`XPAX6` = 6 XPA brews). The schedule is treated as complete up to the last day with a brew.
- Silo 1 ← DME brews. Silos 2 + 3 (treated as one pool; 2 is moved into 3 before a delivery) and Silo 4 (wheat) ← Krones brews. Bagged wheat is not counted against Silo 4.
- After the schedule ends, use = the average daily use of its last four weeks (adjustable in Settings).
- Delivery date = the **latest** allowed day on which the silo still has room for the load and is above your reserve. Order-by = delivery minus notice (weekends roll back to Friday).
- Silo levels are hand estimates, so each reading carries a ±range (default ±3 t per silo, set in Settings). Plans use the best guess; flags warn when the low end would run out first or the high end wouldn't fit a load. Switch the source to **Radar** once installed and the range drops to ±0.3 t.

## Things in ST26 worth knowing

- A blank Silo 2 estimate on a day when Silo 3 has one is treated as empty (matching your sheet's TOTAL VOLUME line).
- Deliveries are any amount typed on a refill line, not only 24,000 and 26,000. On 16 Oct, 6,000 on Silo 1 and 18,000 on Silos 2 + 3 share PO21635, so the site shows it as one split truck.
- `LIMITED` and `DOLCITA` brews on DME have no silo recipe, so they count as 0 kg. `LPA` and `BLACK` on Krones borrow the DME recipe. Listed under *Grain use trends*.
- Ordering Info says wheat can be delivered Thursday **or Friday**; the site follows your rule (Thursday only). Change it in Settings if that has changed.
- The Ordering Info sheet contains plain-text logins. Keep the workbook out of GitHub, and consider moving those to a password manager.

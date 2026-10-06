# Silo Grain Tracker · Balter Brewing

Forecasts when to book pale and wheat malt deliveries from the ST26 brewing schedule, and runs the weekly chemical stocktake with an auto-built order list and usage trends. One Cloudflare Worker: password gate, shared storage, and the static site.

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

## Weekly routine

- **Grain tab:** enter the silo estimates (tonnes) > Save. Add any delivery you book under *Booked deliveries*.
- **Chemicals tab:** enter counts (and anything delivered since last count) > Save stocktake. Copy the order list.
- **After you change the brewing schedule in ST26:** click **Update from ST26** (top right) and pick the workbook. It's read in your browser; the file is not uploaded. Only the schedule, recipes and chemical list are used.

To refresh the data that ships with the site instead: `npm install` then `npm run build-data -- path/to/ST_26.xlsx`, commit `public/data/st26.json`.

## How the grain forecast works

- Silo grain per brew comes from **Recipes 1** (the "Barrett Burston Pale Malt Silo" and "Wheat Malt Silo" lines). Brews come from the date columns on **Demand Summary** (`XPAX6` = 6 XPA brews).
- Silo 1 ← DME brews. Silos 2 + 3 (treated as one pool; 2 is moved into 3 before a delivery) and Silo 4 (wheat) ← Krones brews. Bagged wheat is not counted against Silo 4.
- After the schedule ends, use = average daily use of the scheduled days (adjustable in Settings).
- Delivery date = the **latest** allowed day on which the silo still has room for the load and is above your reserve. Order-by = delivery minus notice (weekends roll back to Friday).
- Silo levels are hand estimates, so each reading carries a ±range (default ±3 t per silo, set in Settings). Plans use the best guess; flags warn when the low end would run out first or the high end wouldn't fit a load. Switch the source to **Radar** once installed and the range drops to ±0.3 t.

## Things in ST26 worth knowing

- Demand Summary's old "Bulk Pale Usage" cells use fixed kg per brew (e.g. XPA Krones 625 kg) that no longer match Recipes 1 (905 kg). The site uses Recipes 1.
- `LIMITED` brews on DME have no recipe, so they count as 0 kg. `LPA` and `BLACK` on Krones borrow the DME recipe. Listed under *Grain use trends*.
- Ordering Info says wheat can be delivered Thursday **or Friday**; the site follows your rule (Thursday only). Change it in Settings if that has changed.
- Synergex 1000L has min 0.3 vs count 10, which looks like mixed units. Flagged "Check units".
- The Ordering Info sheet contains plain-text logins. Keep the workbook out of GitHub, and consider moving those to a password manager.

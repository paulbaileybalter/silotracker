# Silo Grain Tracker · Balter Brewing

Forecasts when to book pale and wheat malt deliveries from the ST26 brewing schedule, and runs the weekly chemical stocktake with an auto-built order list and usage trends. Static site plus two small Cloudflare Pages Functions (password gate, shared storage).

## Put it online (about 15 minutes)

1. **GitHub.** Create a **private** repository and upload everything in this folder. Do **not** upload `ST_26.xlsx` (`.gitignore` already blocks it).
2. **Cloudflare Pages.** Workers & Pages > Create > Pages > Connect to Git > pick the repo.
   Framework preset: None. Build command: *(leave empty)*. Build output directory: `/`.
3. **Password.** Pages project > Settings > Variables and secrets > add two **secrets** (Production):
   - `SITE_PASSWORD` the password you and the crew will type
   - `AUTH_SECRET` any long random string (30+ characters). Never share it.
4. **Shared storage (so entries sync between phone, PC, and the next shift).**
   Workers & Pages > KV > Create namespace (any name works, e.g. `silo-tracker`).
   Pages project > Settings > Bindings > Add > KV namespace > variable name **`SILO_KV`** > choose the namespace.
5. **Redeploy** (Deployments > Retry, or push any commit). Open the site and sign in.

Without step 4 everything still works, but entries stay on the one device (the header shows "Saved on this device only").

Recommended: Cloudflare dashboard > Security > WAF > Rate limiting rule on path `/_auth/login` (e.g. 10 requests per minute per IP) to block password guessing.

## Weekly routine

- **Grain tab:** enter the silo estimates (tonnes) > Save. Add any delivery you book under *Booked deliveries*.
- **Chemicals tab:** enter counts (and anything delivered since last count) > Save stocktake. Copy the order list.
- **After you change the brewing schedule in ST26:** click **Update from ST26** (top right) and pick the workbook. It's read in your browser; the file is not uploaded. Only the schedule, recipes and chemical list are used.

To refresh the data that ships with the site instead: `npm install` then `npm run build-data -- path/to/ST_26.xlsx`, commit `data/st26.json`.

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

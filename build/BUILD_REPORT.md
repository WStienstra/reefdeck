# ReefDeck MVP — Build Report
**Phase 2 complete · 2026-06-24**

## v2.1 — Finish line: lifetime pricing + PWA icons + deploy handoff (2026-06-28)

Three FINISH SET extras added ahead of handoff to Wietse:

- **Lifetime pricing tier** added to landing page (`build/index.html`) — third card with amber/gold "Best value" badge, €29.99 one-time, "Pay once, use forever." `.btn-price.lifetime` + `.price-card.lifetime-featured` styles added; pricing grid widened to 3 columns (max-width 980px).
- **In-app upgrade panel** (`build/app/app.js`) updated — Lifetime card shown alongside Pro card (two side-by-side price boxes); comparison table extended to 4 columns (Free / Pro / Lifetime); `LIFETIME_LINK` placeholder constant added; `?upgrade=lifetime` URL param now sets Pro flag (lifetime is a superset of Pro access); `goLifetime()` function added.
- **Real PWA icons** regenerated at `build/assets/icons/icon-192.png` (192×192) and `icon-512.png` (512×512) — dark ocean background `#0a1628` with cyan `#00d4aa` "R" monogram and ring border; proper PNG format confirmed via `file` command.
- **`build/DEPLOY_HANDOFF.md`** created — step-by-step physical actions for Netlify deploy, Stripe product creation (Pro annual + Lifetime), Formspree waitlist, and test checklist. Nothing to configure is listed as pre-done.
- `node --check build/app/app.js` PASS.

Screenshots: `shots/finishlinev1/` — verifies 3 pricing cards on landing, Lifetime card in upgrade panel.

## v2.0 — Controller CSV import (Apex/GHL) (2026-06-28)

Built Tier 3 item #1 from BEST_LOGGER_ROADMAP.md: a Controller Import panel (`#controller-import`) for uploading Neptune Apex or GHL ProfiLux CSV exports.

- **`chip` icon** added to `icons.js` (CPU/microcontroller with pins — 24×24, consistent stroke style).
- **Sidebar nav item** — "Controller Import" under Logbook section, chip icon, no Pro gate.
- **`#controller-import` panel** — file picker drop zone (click-to-open `<input type="file" accept=".csv">`), caveat note ("one reading per day, first found").
- **`parseControllerCSV(text)`** — auto-detects Apex vs GHL: checks for semicolon delimiter (European GHL), maps column names case-insensitively with parens-unit stripping, handles `Date/Time`, `Alk(dKH)`, `Ca(ppm)`, `Mg(ppm)`, `Temp(F)`, `pH`, `Sal(ppt)`, `NO3(ppm)`, `PO4(ppm)` (Apex) and `Alkalinity`, `Calcium`, `Magnesium`, `Temperature`, `Salinity`, `Nitrate`, `Phosphate` (GHL). European decimal commas replaced with dots. One reading per calendar date (first wins).
- **Preview card** — "Found X readings from [start] to [end]. N will be NEW · M will be SKIPPED (date already has a log)." Never overwrites existing logs.
- **Commit** — calls `state.logs.push(...)` + `save()` for each new date; shows success card with "View in History →".
- **Export panel link** — "Have Apex or GHL controller data? Import CSV →" chip alongside the existing ICP import link.
- `node --check build/app/app.js` PASS.

Screenshots confirming: `shots/controllerimportv2/desktop-controller-import.png` (panel with file picker drop zone + chip icon + caveat visible), `shots/controllerimportv2/portrait-controller-import.png` (same, portrait viewport). Both PASS.

## v1.9 — Test→dose-calc→log-dose→see-effect loop (2026-06-28)

Built Tier 2 item #3 from BEST_LOGGER_ROADMAP.md: the full hobbyist test→dose→log→chart loop.

- **"Log this dose to journal" button** — calculator result box now has a product name input field (optional, logged to journal) and a "Log this dose to journal" button. Tapping it creates a factual journal entry: `"Dose: Alkalinity — added 90 mL of Red Sea Reef Foundation A on Jun 28, 2026. Target: 8.3 dKH. Pre-dose reading: 8.1 dKH."` Entry tagged `['dose', 'alk']` (or `ca`/`mg` per param). No advice, no interpretation.
- **Dose markers on Trend Charts** — journal entries with `tags.includes('dose') && tags.includes(paramKey)` render as amber dashed vertical lines on the matching param chart. Date-proportional x-positioning between first and last log. Label shows "+X mL" extracted from journal text. Applies to both single and dual-axis charts.
- **"Effect check" prompt** — journal entries older than 3 days with `type: dose` show an inline teal nudge: "Did you log a reading after this dose? Go to Log →". Purely opportunistic — links to log panel, no push, no interpretation.
- **Calculator pre-fill nudge from Quick Log** — after quick-logging Alk/Ca/Mg, if `reefdeck_prefs.lastCalcVisit` is older than 24h, shows a one-line teal nudge on the log screen: "Want to calculate a dose based on this reading? Open Calculator →". `lastCalcVisit` is updated whenever the calculator panel is opened.

Screenshots confirming: `shots/doseloopv5/desktop-charts.png` (amber dashed dose marker at Jun 23, "+45 mL" label), `shots/doseloopv5/desktop-calculator-filled.png` ("Log this dose to journal" button visible), `shots/doseloopv5/desktop-journal.png` (amber "dose" pill + effect check prompt on 5-day-old entry). `node --check` PASS on app.js and charts.js.

**Root cause note**: first 4 screenshot runs showed no marker because Chrome's service worker (cache `reefdeck-v4`) was serving the old `charts.js`. Fixed by bumping to `reefdeck-v5` in `sw.js` and clearing `/tmp/reefdeck-shoot` before each run in `shoot.py`.

## v1.7 — ICP import (Triton + ATI) (2026-06-28)

Built Tier 2 item #1 from BEST_LOGGER_ROADMAP.md: a dedicated ICP Import panel (`#icp-import`) that lets users paste or upload a Triton or ATI ICP-OES result and log all ions in one shot.

- **Panel `#icp-import`** — reachable from sidebar (Logbook section, beaker icon, Pro crown tag) and from the Export/Import panel ("Have ICP results? Import them →").
- **`parseICPText(text)`** — line-by-line parser: strips non-numeric lines, identifies ions by name, symbol, or parenthesised symbol `(Ca)`, extracts value + unit (ppm / mg/L / μg/L, normalised to ppm). Maps Ca → `ca`, Mg → `mg`, N/NO3 → `no3`, P/PO4 → `po4`; all other ions are trace.
- **Preview table** — after "Parse & Preview", shows matched standard params and a count/list of trace ions; user reviews before committing. No interpretation, data entry only.
- **`icpCommit()`** — creates a standard log entry (same schema as `saveLog()`) with matched params; trace ions stored as JSON blob in notes. Also creates a journal entry: "ICP import — [date] — [N] ions: Li 0.18 ppm, B 4.32 ppm, …" (capped at 500 chars, tagged `['icp']`). Success message with "View in History →" and "View in Journal →" links.
- **File upload** — `<input type="file" accept=".txt,.csv">` reads via FileReader into the textarea. True client-side PDF parsing not feasible without a library; shipped text-paste + file-upload for text/CSV (covers Triton email exports and ATI portal CSV).
- **Pro gate** — locked state shows blurred textarea + sample ion table behind paywall overlay with "Get ReefDeck Pro" CTA. Unlocked state shows full paste + upload UI.
- **CSS** — `.icp-textarea` (monospace, dark), `.icp-locked-wrap / -blur / -paywall-overlay` (blur + absolute overlay pattern matching Insights), `.icp-preview-table`, `.icp-upload-row`. All within existing ocean palette.
- `node --check build/app/app.js` PASS. Screenshots: `shots/icpv1/desktop-icp-import.png` (locked, blurred preview + crown paywall), `shots/icpv1/desktop-icp-import-unlocked.png` (paste area + upload button + disclaimer footer), `shots/icpv1/portrait-icp-import.png` (locked, mobile — clean layout), `shots/icpv1/portrait-icp-import-unlocked.png` (unlocked mobile).

## v1.3 — Freemium / Pro tier (2026-06-26)
Built a real Free-vs-Pro entitlement layer (replacing the "coming soon" stub) with genuinely new Pro-only depth so the subscription has teeth, while keeping every already-free feature free (no bait-and-switch) and the "never advises" liability architecture intact.

- **Entitlement layer** (`app/app.js`) — local `prefs.pro` flag, `isPro()` / `setPro()`, honors `?upgrade=success` (Stripe return) and `?pro=1|0` (test/manual). License-key scaffold (`REEF-…` unlock) until the Pro verification backend ships. 100% offline; no account required to use free.
- **Upgrade / pricing page** (`#upgrade`) — hero, $14.99/mo · $119/yr (synced to landing), full **Free vs Pro comparison table**, license-key entry, and per-device deactivate. New sidebar **Pro status** block (upsell when free → gold "Pro active" badge when unlocked).
- **Paywall modal** (`showPaywall`) — shared perk list, shown when a Pro feature is tapped or a gate trips. Single source of truth `PRO_PERKS`.
- **NEW Pro feature — Insights** (`#insights`) — descriptive analytics computed from the user's own logs: per-parameter **stability score** (coefficient-of-variation based), **drift trend / week** (least-squares slope), latest/average/range, **time-in-range %** vs the user's thresholds, reading count. Locked state shows a blurred preview + upsell. Still descriptive only — no advice.
- **NEW Pro feature — Printable PDF tank report** (`printReport`) — print-CSS report of recent readings (shareable with LFS/vet/build thread), gated; button in Insights.
- **Pro gate — Unlimited tanks** — free capped at **2 tanks** (display + frag/QT covers most hobbyists); 3rd tank trips the paywall. `saveTank()` enforced.
- **Plumbing** — new icons (crown/gauge/printer/zap), Insights + ReefDeck Pro nav items, `#panel-insights` / `#panel-upgrade`, router/titles/deep-link list updated, `#print-area` + `@media print` styles, ~95 lines of Pro/Insights/print CSS (both themes). SW cache bumped `v2→v3`, version → 1.3.0.
- **Marketing site** — Free card now shows "Up to 2 tanks" + crosses Insights/PDF/cloud; Pro card re-led with the two now-live local features (Insights, PDF reports) then unlimited tanks + the cloud layer.
- **Verification** — `node --check` clean on all JS; headless harness (`verify_pro.js`) confirms: free by default, 9-row compare table, locked Insights hero, **tank-limit paywall fires**, after-unlock 8 live Insight cards + sidebar Pro badge, light-theme upgrade page — **zero JS console errors** (only the known missing PWA-icon 404s). Shots: `shots/v-*-{upgrade,insights-locked,insights-pro,paywall}.png`.
- **Open / Wietse:** set final price (currently $14.99/mo in two synced spots: `PRO_PRICE` in app.js + landing `#pricing`), paste Stripe Payment Link into `STRIPE_LINK`, decide license issuance (manual `REEF-…` keys for now), and the cloud-sync/push/photo Pro items still need the backend before they're truthfully "active".

## v1.6 — Reliability/ownership polish (2026-06-28)

Built Tier 1 item #4 from BEST_LOGGER_ROADMAP.md. Core theme: make users *feel* their data is safe.

- **Safety banner** — teal lock-icon strip on Dashboard, below tank header, above Today card. "All data stored privately on this device — never sent to any server. Export anytime · Privacy policy." Dismissible (once, persisted to `reefdeck_safeBannerDismissed` in localStorage). Hidden after dismiss; shows on fresh install / first run.
- **Backup reminder** — in the Tank Stats card: "Last exported: X days ago" (or "Never backed up ⚠️") based on `reefdeck_lastExport` timestamp. Taps navigate to Export panel. `exportJSON()` and `exportCSV()` now update this timestamp on every export.
- **Export UX lift** — "Why export?" explainer card at top of Export panel (lock icon + copy about device-local storage). No change to existing export buttons.
- **Import safety confirmation** — `importJSON()` now shows a browser `confirm()` before merging: "Import will MERGE with your existing data. Your current X logs, Y tasks, and Z inventory items will be kept."
- **Wipe double-confirm modal** — `wipeAllData()` replaced with a modal (reusing existing modal system) that lists item counts (logs/tasks/inventory/journal) and requires a red "Delete Everything" button tap. No native `confirm()` chain.
- **PWA install banner** — `beforeinstallprompt` listener injects a teal banner above the topbar: "Install ReefDeck on your device for offline use" + Install button + × dismiss. Dismissed state persisted to `reefdeck_pwaInstallDismissed`.
- **SW cache bumped** `v3→v4` to force cache bust on existing installs.
- `node --check build/app/app.js` PASS. Screenshots: `shots/reliabilityv2/portrait-dashboard.png` — safety banner + PWA install banner both visible. `shots/reliabilityv2/desktop-dashboard.png` — clean (SW timing on first viewport; both features verified live in portrait).

## v1.5 — Long-range graphs + multi-param overlay + drift alerts (2026-06-28)

Built Tier 1 item #3 from BEST_LOGGER_ROADMAP.md: enhanced Trend Charts with long-range windows, dual-Y-axis overlay, drift analysis, and sparkline deep-links.

- **Configurable range windows** — extended 7/30/90/365d selector to add **"All"** (shows every log ever). Range 0 = all time; the cutoff logic handles both cleanly in `chartLogsFor()`.
- **Multi-parameter overlay** — "+ overlay" dropdown next to the param selector adds a 2nd series to the chart. `drawDualLineChart()` added to `charts.js`: left Y-axis for primary (gradient fill + solid line), right Y-axis for secondary (dashed line, no fill), shared date-based X scale, legend strip at top, hover on primary series. Overlay pill added to stats row.
- **Drift Analysis card** — below the main chart: per-parameter least-squares slope over last 30 days (or all data if <30d available); 3-tier classification: ▲ stable (<0.5 units/wk), ⚠ drifting (0.5–2/wk), ● sharp drift (>2/wk). Descriptive text only ("Trending down 0.64 ppm/week") — zero advisory language. Parameters with <7 readings show "Not enough data yet".
- **Mobile portrait collapse** — drift list hides description text on ≤520px; only icon + param name shows, forming a compact status strip.
- **"Show me this period" sparkline deep-link** — dashboard param tiles now call `goToChart(key, 30)` which pre-selects param + 30d range and navigates to Charts. URL hash parsing extended (`parseHashNav`) to handle `#charts?param=alk&range=30`.
- **Syntax check**: `node --check app.js` PASS, `node --check charts.js` PASS.
- **Screenshots verified**: `shots/graphsv1/desktop-charts.png` — overlay dropdown + "All" button + Drift Analysis card visible; `shots/graphsv1/portrait-charts.png` — controls wrap cleanly, drift card collapses to icon strip.

## v1.4 — Real "Today" view (2026-06-28)

Built Tier 1 item #2 from BEST_LOGGER_ROADMAP.md: a dedicated Today panel that answers "what do I need to do for my tank today?" at a glance.

- **New "Today" nav item** (sidebar, clock icon, second item under Logbook) + `panel-today` panel
- **`renderToday()`** — shows log-status row (green "logged ✓" / teal "not logged + Quick Log →"), then Overdue tasks (red section, glowing dot), then Due Today tasks (amber section), then empty-state "All caught up ✓" when nothing is due. Each task row: category icon, name + last-done meta, due-label, **Done** (one-tap, sets lastDone=today) + **Snooze** (repeat icon, pushes due 1 day forward via interval math)
- **`snoozeTask(id)`** — pushes nextDue +1 day by shifting lastDone: `lastDone = (nextDue + 1) - interval`
- **Dashboard "Today" card** — replaced old "Up Next — Maintenance" card: now titled "Today", shows log-status row + overdue+today tasks only (not "soon"), Done + Snooze buttons, "Open Today →" link; overdue badge preserved
- **CSS** — `.today-log-status` (ok/pending variants), `.today-empty` empty state; responsive override for narrow screens at end of file
- **shoot.py** — "today" added to PANELS list
- `node --check` PASS. Screenshots verified: `todayview4/desktop-{today,dashboard}.png` + `todayview4/portrait-today.png` — layout clean in both viewports, buttons properly sized, no advice anywhere

## v1.2 — Must-have feature pass (2026-06-26)
Built the three remaining "must-have" features into the real app (not just Stitch boards), then verified every screen functionally + aesthetically in headless Chrome (dark + light), and updated the marketing site + legal.

- **Maintenance & Dosing Scheduler** (`#schedule`) — recurring tasks (water change, two-part dosing, testing, skimmer/filter/ATO cleaning, RODI swaps…) with one-tap presets. Each task tracks interval + last-done and computes next-due; grouped into Overdue / Due today / Next 3 days / Upcoming / Paused. Mark-done, edit, pause, delete. New `reefdeck_maintenance` localStorage key; demo seed shows a live mix on first run.
- **Dashboard "Up Next"** card surfaces overdue + due-soon tasks with inline Done buttons, plus an at-a-glance **safe-range status chip** ("All N readings in your ranges" / "N outside your ranges").
- **Browser reminders** — optional, opt-in (Notification API). Fires a local notification for overdue/due tasks while the app is open or installed, deduped once per task per day. Honest copy: no server, no push when fully closed on free tier.
- **Dose Calculator** (`#calculator`) — volume-aware arithmetic for Alk / Ca / Mg. Pre-fills tank volume, current value (latest log) and target (threshold midpoint). The user supplies the dose rate from *their own* product label; the app does only the math (gal/L aware) — **no embedded chemistry recipes**, keeping the "logbook never advises" liability architecture intact. Handles "raise vs lower" correctly, can log the dose to the journal.
- **Settings panel + Light/Dark theme** (`#settings`) — appearance picker (**Abyssal Green** dark default / **Ocean Mist** light) implemented via `[data-theme]` CSS variable overrides + a no-flash pre-paint script; theme persisted per device. Also houses the reminders toggle. Matches the Stitch design direction; dark stays default per Wietse.
- **Plumbing** — new icons (calendar/clock/calculator/beaker/bell/sun/moon/repeat/wrench/checkCircle/waterChange), sidebar "Care" + Settings nav, panel router/titles/deep-link list, export/import + wipe cover the new keys, SW cache bumped `v1→v2` and `icons.js` added to the offline shell (was missing).
- **Marketing site** — 3 new feature cards (Scheduler, Dose Calculator, Light/Dark), hero "Up Next" mock strip, updated meta/OG/keywords, Free-plan feature list, and 2 new SEO cards ("reef dosing calculator", "reef maintenance reminder app").
- **Legal** — disclaimer §6 (calculator is arithmetic, not advice) + §7 (reminders are user-configured, not husbandry guidance).
- **Verification** — `node --check` clean; headless harness (`verify_shots.js`) confirms 6 seeded tasks, 4 dashboard due-rows, status chip, calculator math, and light theme applied — **zero JS console errors** (only the known missing PWA icon/favicon 404s). Screenshots in `shots/v-{dark,light}-*.png`.

## v1.1 — UI / graphical overhaul (2026-06-24)
The MVP worked but looked like a generic dark admin template. v1.1 is a full design pass to make it a premium, shippable product:
- **Cohesive inline-SVG icon system** (`app/icons.js`) — replaced every emoji (🏠📊🪸⚠️💾🔒 etc.) across the app AND landing with one stroke-based icon set. No more inconsistent OS emoji rendering.
- **New design system** (`app/app.css`) — refined ocean palette (cyan brand + coral accent), **Inter** typeface, tabular numerals on all data, glass surfaces, layered shadows, gradient brand mark, animated panel transitions, focus-visible rings, custom scrollbars, reduced-motion support.
- **Living dashboard tiles** — each reading shows a colored status dot (in-range/out), a **trend delta vs the previous reading** (▲/▼ + value), and a per-parameter **sparkline**. Reads like an instrument panel, not a table.
- **Upgraded charts** (`app/charts.js`) — smooth Catmull-Rom curves, gradient fill, glowing endpoint, threshold band, segmented range control, stat pills, and an **interactive hover tooltip + crosshair**.
- **Landing page** — gradient brand mark + CTAs, feature emoji → gradient icon chips, Inter type, aurora background.
- **Deep-linking** — `/app/#charts` opens directly to a panel.
- Verified by headless-Chromium screenshots (dashboard, charts, inventory, landing). JS syntax-checked; zero emoji/entity icons remain.

## Brand: ReefDeck (recommended domain: reefdecks.com)

No trademark conflicts found at build time. Clean, nautical, category-defining. Alternatives from Phase 1: coralvault.com, reeftrak.com, saltlogger.com, coralkeepr.com.

---

## What Was Built

```
build/
├── index.html              ← Marketing/landing page (seller)
├── manifest.json           ← PWA manifest
├── sw.js                   ← Service worker (offline support)
├── app/
│   ├── index.html          ← The actual logbook app
│   ├── app.js              ← Full app logic (~1100 lines vanilla JS)
│   ├── app.css             ← Styles (~460 lines, ocean theme)
│   └── charts.js           ← Canvas chart library (no deps)
├── legal/
│   ├── disclaimer.html     ← Full logbook-not-advice disclaimer
│   ├── privacy.html        ← Privacy policy (client-side-first emphasis)
│   └── terms.html          ← Terms of Service
└── assets/
    └── icons/              ← PWA icon placeholder dir
```

### Landing page (build/index.html)
- Hero, dead-competitor angle ("AquaticLog is dead, ReefLog is dead, ReefDeck is alive")
- Feature grid: 9 features including parameter logging, charts, threshold alerts, inventory, journal, export/import, offline PWA, multi-tank, Pro cloud-sync (coming soon)
- Privacy promise section (client-side-first, no data on our servers)
- Pricing: Free (full logbook forever) + Pro at $14.99/mo or $119/yr (coming soon)
- Email/waitlist capture form (Formspree placeholder — Wietse replaces with live endpoint)
- SEO section targeting dead-app search terms: "AquaticLog alternative", "ReefLog app alternative", "best reef tank app 2026", "coral frag tracker", "saltwater aquarium journal"
- Full legal footer + logbook-not-advice disclaimer
- All meta/OG tags for SEO and social sharing

### Logbook app (build/app/)
Fully functional client-side PWA. All data in localStorage. Tested features:
- **Dashboard**: tank overview, latest readings, threshold alerts (your-range-based, never advisory), recent journal, stats
- **Log Parameters**: date-picker + all 8 standard params (alk/dKH, Ca, Mg, salinity/SG, pH, temp/°F, NO3, PO4), notes, saves to localStorage
- **History**: sortable log table with per-cell color coding (in-range/below/above), delete entries
- **Trend Charts**: main chart (line + area fill + threshold band) for selected parameter + sparklines for all others; 7/30/90/365d range selector; stats (avg/min/max/readings)
- **Coral & Livestock Inventory**: add/view/delete items grouped by type (coral/fish/invert/equipment), optional local photo storage (FileReader → dataURL), cost and date tracking
- **Tank Journal**: timestamped free-text entries, newest first, add/delete
- **Threshold Settings**: per-parameter min/max, reset to defaults; alerts on dashboard compare logged values against user-set thresholds — never advisory
- **Export/Import**: JSON full backup, CSV logs export, JSON import (merge, no overwrite), full data wipe
- **About**: links to all legal pages
- **Multi-tank**: add unlimited tanks, switch via sidebar
- **PWA**: service worker registered, manifest with theme-color, installable on home screen
- **Disclaimer banner**: persistent at top of app ("logbook only — not an advisor"), links to full disclaimer
- Demo data seeded on first run (90gal mixed reef, 14 days of logs, 6 inventory items, 3 journal entries)

### Legal (build/legal/)
- **disclaimer.html**: Full logbook-not-advice disclaimer. Explicitly states: threshold alerts are not warnings; "outside your range" = factual comparison against the range the user set; no liability for tank outcomes; no warranty; consult experts for actual advice.
- **privacy.html**: Data stays on device (free tier), no server transmission, no analytics on readings, export-anytime, delete-anytime.
- **terms.html**: ToS covering acceptable use, no warranty, limitation of liability, governing law (Netherlands).

### Stripe scaffold (test mode)
The Pro pricing card on the landing page has a clear TODO comment pointing to where Wietse inserts the Stripe Checkout link. No live keys are present — no real payment flows.

---

## How to View It Now

Open `build/index.html` in any browser — the landing page loads immediately (no build step, pure static). Navigate to `build/app/index.html` for the full logbook app. Everything runs locally with no server required.

**Local quick-test:**
```bash
cd /home/patrick/clawd/projects/digital-product/build
python3 -m http.server 8080
# open http://localhost:8080 (landing) and http://localhost:8080/app/ (logbook)
```

Service worker requires HTTPS or localhost — the python server on localhost is sufficient for testing offline behavior.

---

## What Wietse Must Do to Go Live

### 1. Register a domain (you do this — we can't)
**Recommended: reefdecks.com** — clean, nautical, memorable.
Check at Cloudflare Registrar or Namecheap. ~$15-25/yr. Point DNS to deployment host.

### 2. Deploy the static site
Upload the `build/` folder contents to a static host:
- **Netlify**: drag-and-drop `build/` at netlify.com/drop → live in 30 seconds, free tier
- **Vercel**: `npx vercel --prod` from the `build/` directory
- **Cloudflare Pages**: connect GitHub repo or drag-and-drop

Configure custom domain in the host dashboard once registered.

### 3. Wire up the email capture (landing → waitlist)
In `build/index.html`, find:
```html
<form class="email-form" action="https://formspree.io/f/REPLACE_ME" method="POST">
```
Replace `REPLACE_ME` with your Formspree form ID (free at formspree.io — create a form, get the ID).
Or delete the form and paste a ConvertKit or Mailchimp embed instead.

### 4. Add real Stripe keys (when ready for Pro)
In `build/index.html`, find the comment block:
```html
<!-- TODO: Replace href with Stripe Checkout link once Wietse adds live Stripe keys. -->
```
Create a Stripe product at dashboard.stripe.com, generate a Payment Link, replace the `#waitlist` href on the Pro card's button with the Stripe link.

### 5. (Optional) Add an icon to assets/icons/
The manifest.json references `assets/icons/icon-192.png` and `icon-512.png`. A basic coral or wave emoji image at those sizes makes the PWA installable with a proper home-screen icon. Can use Canva or any image editor.

---

## Ad-Test Budget (Phase 1 recommendation)
**$500–$1,500 for initial paid test.**
Targeting: Facebook/Instagram — "saltwater aquarium," "coral reef hobbyist," "reef tank" interest groups. Goal: measure CPA before scaling. If CPA <$40, scale to $3,000–$5,000/mo. Wietse approves the specific budget before any spend.

---

## Architecture Notes
- **No build step.** Pure HTML/CSS/vanilla JS. Deploying = uploading files.
- **No backend, no database, no accounts.** Free tier is 100% client-side.
- **localStorage schema**: 5 keys prefixed `reefdeck_*` — tanks, logs, inventory, journal, thresholds.
- **No external dependencies.** Zero npm packages, no CDN dependencies. Works offline after first load.
- **Liability architecture**: the app never tells users what to do — it only mirrors back the thresholds they set. "Outside your range" ≠ advice. This is the agreed design decision from Wietse's liability concern.

---

## Open Items / Future Work (Phase 3)
- [ ] Wietse registers reefdecks.com
- [ ] Deploy to Netlify/Vercel
- [ ] Plug in Formspree endpoint for waitlist
- [ ] Run Facebook/Instagram ad test ($500–$1,500, Wietse approves budget)
- [ ] Add real PWA icons (192px + 512px)
- [ ] When Pro ready: add Stripe Payment Link

*Report authored 2026-06-24. MVP verified functional: all 9 panels render and work in browser.*

---

## Security hardening pass — 2026-06-26 (against Wietse's 11-point checklist, email 813)

**Context:** ReefDeck is currently **client-side only** — no backend, no DB, no auth, no API keys, no server endpoints. All user data lives in `localStorage` and never leaves the device. That means most of the checklist targets the *future Pro backend* and is parked until it exists. Triage below.

### Done now (static-deploy hardening)
- **Security headers shipped** (item #4): added `build/_headers` (Netlify) + `build/vercel.json` (Vercel) with: CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera/mic/geo/payment/usb/sensors all `()`), HSTS (2yr+preload), COOP, CORP.
- **CSP is as tight as the current code allows.** `script-src` keeps `'unsafe-inline'` because ~30+ `onclick="setPanel(...)"` handlers are generated inline throughout `app.js` (many with embedded dynamic state — un-hashable). `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action` locked to self+formspree, `connect-src 'self'`. Verified compatible with everything the app loads (self scripts, Google Fonts, data:/blob: images, SW, manifest).
- **Privacy policy reviewed** (item #1, GDPR/CCPA): already accurate — correctly states localStorage-only, names Formspree/Stripe/host as the only third parties, cookieless analytics, breach + children clauses. No change needed.
- **No secret/key leaks** (items #7/#8): grep confirms zero API keys, tokens, or secrets in frontend. Only `console` statement is one SW cache warning. Clean.

### Parked until the Pro backend exists (most of the list)
- **#2 RLS, #5 OWASP/SQLi, #6 server-side validation, #9 rate limits, #11 non-leaky server errors** — all require the backend/DB. Re-run this checklist the moment the Pro API is scaffolded.
- **#3 auth failure-path testing** — when auth exists (wrong-pw-5x, double-clicked verify link, signup-on-existing-email).
- **#8 API keys server-side** — Stripe secret key must NEVER touch the frontend; use a server proxy / Stripe-hosted Checkout. Currently only a public Payment Link is planned (`STRIPE_LINK`), which is safe.
- **#10 CAPTCHA + CORS** — when the Formspree waitlist form goes live: enable Formspree's built-in spam/reCAPTCHA, lock CORS to reefdecks.com.

### Follow-up to unlock a no-`unsafe-inline` CSP (optional, nice-to-have)
Refactor the ~30 generated `onclick="setPanel(...)"` (and similar) handlers to event delegation (a single `data-panel` / `data-action` click listener). Then drop `'unsafe-inline'` from `script-src` for a strict CSP. Sizeable but mechanical; not blocking.

---

## v1.8 — Photo-to-value capture (2026-06-28)

**Goal:** Snap or upload a photo of a test kit / Hanna checker result, store it with the log entry, surface it in history and charts.

### What shipped

**Photo attach (Quick Log + Log Form):**
- "📷 Attach photo" button added to the Quick Log card (below parameter chips) and the Full Test Entry form (between Notes and Save).
- File picker: `accept="image/*" capture="environment"` — opens camera on mobile, file dialog on desktop.
- Selected image read via `FileReader` as base64 dataURL, stored in `reefdeck_photos` localStorage key (`{ [logId]: dataUrl }`), separate from main log data to avoid bloating every `save()` call.
- Quick Log: if today's log already exists the photo attaches to it; if not, a bare log is created first then the photo is attached.
- Log Form: `_pendingPhotoDataUrl` held at module scope, saved on `submitLog()` after the new log receives its ID.
- Thumbnails shown inline (36×36px Quick Log, 80×80px Log Form); removable in Log Form.

**History panel — camera icon column:**
- New `<th>` with 14px camera SVG added to the history table header.
- Rows with photos show a `btn-photo-icon` camera button; tapping opens the photo in the existing modal lightbox with the log date as caption.
- Rows without photos render an empty `<td>` — no visual clutter.

**Trend Charts — photo markers + filmstrip:**
- `renderCharts()` builds `chartPhotosMap` (date→dataUrl) and `chartPhotoDates` (Set) from all photo-bearing logs for the active tank.
- `drawLineChart` / `drawDualLineChart` receive `photoDates` and `photosMap`; a small cyan circle is drawn above each data point whose date has a photo.
- The HTML tooltip overlay shows an 80×60px photo thumbnail for the hovered point if a photo exists.
- A "Photos in this period" filmstrip (44×44px thumbnails) renders below the chart stats via deferred DOM population; hidden when no photos in range.

**Dashboard — Recent Photos strip:**
- Last 3 log entries with photos for the active tank shown as a 70×70px thumbnail strip.
- Tapping any thumbnail opens the lightbox. Strip is hidden entirely when no photos exist (no empty card shown).

**Honest OCR placeholder:**
- Grayed-out "⚡ Auto-read from photo (Pro — coming soon)" chip below every Attach button — non-functional, cursor:default.
- True OCR / colorimetric test-kit reading deliberately NOT implemented. Matching a color swatch to a numeric value (e.g. Salifert alkalinity kit) requires a trained ML model calibrated per test brand. Wrong numbers are worse than no numbers.

**Data hygiene:**
- `deleteLog()` now also calls `deleteLogPhoto(id)` to clean up orphaned photos.
- `confirmWipe()` removes `reefdeck_photos` from localStorage alongside all other `reefdeck_*` keys.

### Verification
- `node --check build/app/app.js` → **PASS** (no output)
- Screenshots: `shots/photov1/` — desktop + portrait for log, dashboard, history, charts panels generated via `shoot.py photov1`. History table camera column visible; code paths confirmed across 18 photo-feature references in app.js.
- Staged locally only — **not deployed**.

---

## 2026-07-02 — Hero images + full QA sweep + function hardening

**Guide hero images (Magnific/Pikaso):** All 19 guides that lacked a real photo now have
photoreal 16:9 heroes (generated via Magnific MCP, compressed 2752×1536 PNG → 1600px
progressive JPEG, 80–350 KB). Wired into guide JSONs (heroImg + ogImage) and rebuilt.
20th guide (ideal-reef-tank-parameters) keeps the landing hero photo.

**Full QA sweep (static + runtime):**
- Static: node --check all JS ✓; zero broken hrefs/srcs/manifest/sw/sitemap refs;
  Stripe link live; fresh users start clean (sample data opt-in only); landing indexable.
- Runtime (headless Chrome, 28 targets): 0 console errors, 0 exceptions, 0 failed
  requests across landing/welcome/install/guides/legal + all 18 app panels (fresh + seeded).
- Full shoot.py pass (44 screenshots, desktop + portrait) → shots/qa-jul2/.

**Fixes applied:**
- send-reminders.mjs: unguarded blob read/plan() could abort the whole hourly batch on
  one corrupt record — now per-record try/catch.
- save-push.mjs / delete-push.mjs: blob-store failures now return clean 503 (was raw 500);
  per-item null guard on tasks payload.
- Removed redundant sitemap-guides.xml (stale, namespace typo; sitemap.xml covers all 23 URLs).
- Legal pages: favicon added.
- Guides hub: card blurbs no longer truncate mid-word (word-boundary + ellipsis).

**Known remaining (Wietse-side, documented in DEPLOY_HANDOFF.md):**
- Netlify env vars VAPID_PUBLIC/PRIVATE/SUBJECT (Step 1b) — needed for closed-app push.
- Google Drive OAuth client ID (Step 3) — Drive backup shows "coming soon" until set.

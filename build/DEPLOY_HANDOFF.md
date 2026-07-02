# ReefDeck — Deploy Handoff

## You need ~30 minutes and these accounts: Netlify (free), Stripe, optionally Formspree.

### Step 1: Deploy to Netlify — now via Git (the push backend needs a build step)
ReefDeck now has a backend (closed-app push reminders = Netlify Functions), so the
old "drag the build/ folder" deploy no longer works for the functions. Switch to a
Git-connected deploy ONCE — after that, every change deploys automatically on push
(and no more token-costly manual drops).

1. Create a new GitHub repo and upload the contents of this repo zip (root = where
   `netlify.toml` lives, with `build/`, `netlify/functions/`, `package.json`).
2. netlify.com → "Add new site" → "Import from Git" → pick the repo.
   - Build command: (leave empty)
   - Publish directory: `build`
   - Functions directory: `netlify/functions`  (already set in netlify.toml)
3. Deploy. You get a URL like `reefdeck.netlify.app`; point `reefdecks.com` at it.
   Netlify auto-installs deps, bundles the functions, and registers the hourly
   reminder schedule from netlify.toml. Netlify Blobs (the push datastore) needs
   no setup — it works automatically on deployed functions.

(Prefer not to use Git? The alternative is the Netlify CLI: `netlify deploy --prod`.
Drag-and-drop alone cannot deploy functions.)

### Step 1b: Push notification keys (required for closed-app push) — 2 min
In Netlify → Site settings → Environment variables, add:
- `VAPID_PUBLIC`  = `BLIpCo0Xs0rm_wu2gpPqEXtCt6j0PjCa6qA8_YrnyVcg5Rm3I9sgbm9NwvuwAK8EdLXYQLt-dD6bZIcmtbN4ntI`
- `VAPID_PRIVATE` = (the private key — I sent it to you separately; never commit it)
- `VAPID_SUBJECT` = `mailto:hello@reefdecks.com`
The matching public key is already baked into `build/app/push.js`. If you ever rotate
keys, update both the env var and that file together.

### Step 2: Create Stripe product (10 min)
Pricing is LOCKED: **€9.99/year, annual-only, auto-renewing. One product. No monthly, no lifetime.**
1. dashboard.stripe.com → Products → Add product → "ReefDeck Pro" → **€9.99/year recurring**
   - Copy the Payment Link URL
   - In `build/app/app.js`: find `STRIPE_LINK` (line ~3221) and paste the URL over the placeholder
2. Re-deploy: drag `build/` to Netlify again (or connect GitHub for auto-deploy)

### Step 3: Turn on Google Drive backup (Pro feature) (~15 min, one-time)
This is the ONLY thing blocking the "Back up to your own Google Drive" Pro feature.
Until you do it, the app shows it as "Coming soon" (no broken buttons). No client secret needed.
1. console.cloud.google.com → create or pick a project.
2. APIs & Services → Library → enable **Google Drive API**.
3. APIs & Services → OAuth consent screen → **External** →
   add the scope `.../auth/drive.appdata`. While unverified, add your own email
   (and any testers) under "Test users". (Submit for verification later if usage grows past 100 users.)
4. APIs & Services → Credentials → Create credentials → **OAuth client ID** → **Web application**.
   Under "Authorised JavaScript origins" add:
   - `https://reefdecks.com`
   - (optional, only for local testing) `http://localhost:8080`
5. Copy the generated **Client ID** (ends in `.apps.googleusercontent.com`).
6. In `build/app/drive.js` (top of file): paste it into `DRIVE_CLIENT_ID = ''`.
7. Re-deploy. The Drive backup buttons go live for Pro users automatically.
   (You can then flip the public "Coming soon" labels to live — ask Patrick, it's a 2-line change.)

### Step 4: (Optional) Newsletter signup — currently REMOVED
The email-capture form was removed because it posted to a placeholder and 404'd on submit.
To re-enable: create a form at formspree.io (or ConvertKit), then paste the embed/endpoint
into `build/index.html` where the `<!-- EMAIL CAPTURE / WAITLIST ... -->` comment is.

### Step 5: Test
- Visit your Netlify URL, click "Get Pro" → should land on Stripe checkout
- Install the PWA — see `/install/` for per-device steps; iPhone shows an in-app "How" banner
- Test: log a param, export JSON, re-import it
- If Drive backup is configured: as a Pro user, Export/Import panel → "Back up to Google Drive"

### What's already done (nothing to configure)
- Security headers: `build/_headers` (Netlify) and `build/vercel.json` (Vercel) are included
- PWA icons: `build/assets/icons/icon-192.png` + `icon-512.png` present
- All legal pages: `build/legal/disclaimer.html`, `privacy.html`, `terms.html`
- Service worker: `build/sw.js` — offline support works out of the box

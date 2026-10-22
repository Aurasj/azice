# AziCe? — rapid phone-first PWA starter

**Status: functional LOCAL DEMO + Supabase integration draft. Not production-ready.**

AziCe? is a dark, English-language, friends-only social app with "I Drank" and "I Didn't Drink" posts. It is a lightweight, dependency-free PWA, chosen so the first UI runs immediately without a build tool. It can be opened in Google Antigravity and enhanced by Gemini. It has NO relationship to Beyuno's source, keys, data, or migrations.

## 1. Run it now — no API keys needed

Open this folder in Antigravity, then in its terminal:

```bash
python -m http.server 5173
```

On Windows, use `py -m http.server 5173` if `python` is unavailable.
Visit **http://localhost:5173**. Because `config.js` has no Supabase credentials, it automatically runs a **clearly labeled local demo**, with sample posts and friends, local storage, profile, 48-hour feed, reactions, comments, a 4-step posting flow, phone camera capture, a calendar, and English UI.

The demo is **not networked**: invite links are examples and do not create real friend connections. It is for reviewing interaction, not actual friend testing. Camera capture requires a real camera and secure context (`localhost` or HTTPS).

## 2. Connect REAL accounts, photos, friends, and comments

1. Create a **NEW Supabase project**, dedicated to AziCe?. Never reuse Beyuno's project.
2. In Supabase **SQL Editor**, execute `supabase/schema.sql` **once** on the empty new project. Before public use, review the RLS policies and access functions with Gemini/security tests.
3. In **Authentication**, configure email confirmation and optionally Google OAuth. Configure both the website URL (eventually `https://azice.aagameri.tech`) and authorized redirect URLs for local development and deployment.
4. Edit `config.js` using only values from your new Supabase project:

```js
window.AZICE_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabasePublishableKey: 'YOUR_PUBLIC_PUBLISHABLE_KEY'
};
```

**Never paste the `service_role`, secret, or other privileged keys into a browser app.**

5. Reload the PWA. It will switch automatically from local demo to Supabase-backed mode. After email/Google authentication, complete onboarding, then use the personal invite link under **Profile → Friends & Invites**. Use two distinct user accounts to check privacy and social interactions.
6. Test on a real Android and iPhone via **HTTPS** (camera support/permissions may differ). Ensure the Google OAuth redirect URLs include the deployed domain.

The Supabase SDK is loaded from jsDelivr in online mode. An offline/mobile-first polish pass should vendor or bundle dependencies and add a repeatable build/test toolchain before wider release.

## 3. What is implemented in this starter

- English-only UI, Dark Modern with warm orange accent, 2-tab navigation + plus button.
- PWA manifest, icons, service worker caching only public shell (not private posts/photos).
- Google/email auth interface and profile onboarding with 18+ self-attestation (Supabase mode).
- Profile display name, username, 150-character bio, gallery-only avatar upload.
- Personal regenerable invite token, friend requests, accept/decline/cancel and unfriend (Supabase mode).
- Two post types, **up to 3 photos taken in the built-in camera** (no gallery input for posts), reason mandatory (up to 300 characters), 4-step preview and final confirmation.
- Home feed: own + friends' posts from the last 48 hours (newest first).
- A single emoji reaction per user/post, changeable/removable; flat, 300-character comments. Both close 48 hours after publication.
- Owner's monthly calendar with orange and teal markers, separate day view; friends' profiles show only the last 30 days of posts read-only after 48 hours.
- Posts and comments cannot ordinarily be edited/deleted from the UI; no report UI, no notifications, no friend search.
- Private Supabase Storage buckets and initial RLS policies for friend-scoped content.

## 4. NOT done or verified — mandatory before public release

- Real Supabase end-to-end run with two accounts; database schema **was not applied or tested against a live Supabase project** in this environment.
- Proper self-service **account deletion/data erasure**, an owner privacy-removal route, and a minimal abuse/safety contact or escalation path. These are important even if the first UI has no Report button.
- Camera testing on Android Chrome and iOS Safari/PWA, Google OAuth setup, email confirmation, deployment and DNS.
- Security review: RLS adversarial tests (post access before friendship / after unfriend / 30-day expiry; storage image read and share; friend request RPC; spoofed fields; race conditions), rate limits, and file lifecycle/cleanup for orphan drafts / superseded avatars.
- Accessibility pass, image loading optimization, profile avatar cropping controls, all historical posts pagination, production tests, privacy policy, and operational backup/recovery.

**Do not expose this as an unrestricted public service before completing the safeguards above.** Private beta UI review is fine with demo data; friend testing requires separate Supabase setup and safety controls.

## 5. Local checks

```bash
node --check app.js
node --check cloud.js
node --check demo.js
node --test tests/demo.test.mjs
```

The provided unit checks validate demo posting, feed, emoji behavior, comments, and friend removal. They do not replace live service tests.

## 6. Deploy later

Create a **separate Netlify site** pointing at this folder/repository, using `netlify.toml`; no build command, publish directory `.`. Configure **`azice.aagameri.tech`** as the custom domain and enable HTTPS. Do not touch `www.aagameri.tech`, `/public/study`, `/public/pacanele`, or `beyuno.aagameri.tech`. Update the Supabase Auth Site URL and OAuth allowed redirects accordingly.

## 7. Gemini continuation

Paste the instructions in `GEMINI_NEXT_STEP.md` into Antigravity's Gemini agent while this project folder is open.

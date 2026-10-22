# AziCe? beta deployment

1. Copy `scripts/build.mjs`, `netlify.toml`, then append `dist/` to the existing `.gitignore` into the repository.
2. Run `node scripts/build.mjs` locally, then inspect `dist/`. It should contain
   only `index.html`, `app.js`, `cloud.js`, `demo.js`, `config.js`,
   `styles.css`, `sw.js`, `manifest.webmanifest`, and `assets/`.
3. Run `node --test tests/*.test.mjs` in a shell that expands the glob (PowerShell
   alternative: `node --test (Get-ChildItem .\tests\*.test.mjs).FullName`).
4. Stage and commit only the approved deployment changes, then push to `main`.
5. Connect GitHub `Aurasj/azice` as a NEW Netlify site. The config declares
   build command `node scripts/build.mjs` and publish directory `dist`.
   Deploy first to the Netlify preview hostname and verify there are no
   unexpected public resources under `/tests/`, `/supabase/`, or `/server.mjs`.
6. Add `azice.aagameri.tech` as a custom domain to this *new* Netlify site.
   Configure DNS using the value Netlify shows; verify HTTPS.
7. In Supabase Auth URL Configuration, set the Site URL to the production app
   address and retain `http://localhost:5173/**` and add
   `https://azice.aagameri.tech/**` as additional redirect URLs.
   The Google OAuth authorized redirect URI remains
   `https://zrbfofxixdbbryrnjzon.supabase.co/auth/v1/callback`.
8. Test email/Google sign-in, new friend request, photo upload and
   download, and PWA install on a real phone.

IMPORTANT:
- This is a static asset packaging step, not a minifying/transpiling build.
- Do not upload the entire repository root to Netlify.
- Do not place service-role / `sb_secret_` keys in `config.js`.
- Source tests are local; repeat critical security checks on the hosted beta.

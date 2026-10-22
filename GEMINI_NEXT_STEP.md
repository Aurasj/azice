# Paste into Gemini in Google Antigravity (with this folder open)

You are continuing a pre-existing project: AziCe? mobile-first PWA. **Do not replace the project or switch stacks without explaining why.** Read README.md, app.js, cloud.js, demo.js, and supabase/schema.sql first.

GOAL: Get a secure, real two-account friends-only beta running as quickly as practical, without changing unrelated projects. All app UI must be English; discussions and status reports can be Romanian. Code should prioritize correctness and small scope over extra features.

**Product contract (do not silently change):**
- Everyone 18+ can sign up with Google or email/password. Friend links are personal, permanent until regenerated, and require approval. No username search and no group chats.
- Feed shows my posts + confirmed friends' posts for **48 hours** after each post is published, newest first. Reactions/comments close at exactly 48 hours. A friend's profile shows read-only posts up to **30 days**; my own private dot-calendar and day detail keep my historical posts.
- Multiple daily posts. Categories only "I Drank" / "I Didn't Drink". Capture at most **3 photos using an in-app phone camera only**, no gallery upload for posts; 1+ photo needed for I Drank, optional for I Didn't Drink. A required 1–300 character reason (free text + suggestions). Step flow: category → photos → reason → final preview/confirmation.
- One of 😂 ❤️ 😮 🔥 👏 per person per post; flat comments max 300 characters; no nested replies.
- Posts/comments immutable in normal UI, with no ordinary edit/delete buttons. Keep necessary legal/privacy/safety-removal and account erasure processes. Profile name/unique username/bio (0–150 chars) editable anytime, avatar **gallery only**.
- Dark charcoal/orange UI, only Feed and Profile bottom tabs + prominent '+' post button; friends accessible from profile; **no notifications, report button, blocking or moderation dashboard in MVP**.
- Avoid alcohol-drinking games, streaks, ranking people by drinking, consumption challenges, and prompts that pressure drinking.

WORK PLAN — perform and verify sequentially:
1. Check static files for runtime issues. Run the local demo. Fix bugs and add smoke tests (not just hypothetical). Preserve the zero-dependency starter unless bundling improves reliability without delaying the beta.
2. Thoroughly audit `supabase/schema.sql` security, PostgREST nested selection, OAuth/sign-up flow, Storage object policies, friendship RPCs, and time windows. Apply to **a new separate Supabase project** only with explicit connection credentials provided by owner. Write migration-safe SQL and adversarial RLS tests; never use privileged keys in browser code.
3. Test with two genuine distinct accounts: invite/revoke link, request/accept/decline/cancel, posting/photo upload, reactions/comments, unfriend visibility, 48-hour read-only and 30-day friend retention, username changes, denied anonymous access. Confirm no private photo URLs leak into a public bucket.
4. Implement a minimal account deletion + data erasure path and accessible privacy/safety takedown contact pathway BEFORE any public beta. Respect owner choice: no full in-app report UI or moderation dashboard for now.
5. Check Android Chrome and iPhone Safari/PWA install & camera behavior over HTTPS; handle camera permissions/errors and photo compression. Test Auth redirect on PWA after Google sign-in.
6. Leave separate GitHub repo and Netlify setup instructions for subdomain `azice.aagameri.tech`; never edit Beyuno, root portfolio, or existing StudyTrack/pacanele routes.

After each stage, report: what is actually verified, failed/blocked, commands/tests run, files changed, any necessary user manual setup, and whether public deployment is safe. Don't claim live functionality until verified.

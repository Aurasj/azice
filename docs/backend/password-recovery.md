# Password recovery and release badge

> **Current reading note:** Password recovery is shipped. Email/dashboard procedures below are reference steps, not authorization to change the working Auth/email configuration.
> Commands assume the repository root. See the [documentation index](../README.md)
> and [deployment status](../../DEPLOY.md) before any operator action.


## Application behavior

`app.js` defines the manually maintained `APP_VERSION` (`MAJOR.MINOR.FEATURE.PATCH`). The locally prepared release's shared header displays `BETA v0.1.1.1`; the recorded production baseline is BETA v0.1.1.0 at main `34b4766`. This local preparation is not a deployment. There is no browser-stored version or commit-based increment. The badge describes the JavaScript build actually running: an offline cached build can still show its older version until updated online through the existing service worker.

Sign In → Forgot password? requests a Supabase Auth recovery email. Successful requests and unknown-account responses use the same generic message. Request failures offer retry without exposing Auth/SMTP details. No permission or email request happens automatically.

Recovery callbacks support PKCE `?recovery=1&code=…`, implicit `#type=recovery&access_token=…&refresh_token=…`, and explicitly typed `?type=recovery&token_hash=…`. Credentials are removed from the address bar before SDK initialization; ordinary OAuth codes are left alone. Normal auth routing cannot replace an active recovery form. New passwords require matching confirmation and 8–128 characters; Supabase's password policy remains authoritative.

A separate Auth client handles recovery. Only its PKCE verifier is shared in localStorage; temporary recovery sessions and the 30-minute resume marker are in sessionStorage. Before changing a password, Auth verifies the recovery account matches the account that opened the form. Updating or leaving recovery clears that temporary session using local-scope sign-out. It does not replace or sign out another account's ordinary application session. Returning to the app restores that existing session, or shows Sign In if none exists. Supabase may invalidate other sessions belonging to the recovered account according to its normal policy.

## Manual Supabase dashboard setup — not performed by this change

1. Confirm Auth → URL Configuration keeps the existing production Site URL (`https://azice.aagameri.tech`) and existing Google, registration and invitation redirect configuration.
2. Add the exact recovery redirect `https://azice.aagameri.tech/?recovery=1` to Redirect URLs. The frontend uses the current deployed origin, so separately allow explicit localhost/preview recovery URLs only when testing there. Avoid broad production wildcard allowances. Do not replace existing allowlisted URLs.
3. Keep the recovery email template's Supabase `{{ .ConfirmationURL }}` link. It performs Auth verification and preserves the requested recovery redirect. If customizing templates, verify that redirect parameters and the PKCE code or implicit recovery fragment survive. Do not replace it with a plain app link. The optional token-hash callback format above is supported, but changing templates is not required. Never put private keys or user-supplied identities in a template link.
4. Manually configure a verified SMTP provider in Supabase Auth email settings when approved. Use `no-reply@aagameri.tech` as the sender. Store SMTP credentials only in the dashboard/provider secret configuration; no frontend credentials or sender configuration are needed.
5. Follow the selected provider's exact SPF/DKIM/domain-verification instructions and review DMARC separately. No DNS records are supplied or changed here. Review sender name, recovery expiry, password policy, email rate limits and production email delivery restrictions in Supabase.
6. Disable email-provider link tracking/rewrite where it breaks Auth URLs. Email scanners can consume single-use links; verify with the actual provider and use the latest newly requested link during tests.

References: [Supabase password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [password authentication](https://supabase.com/docs/guides/auth/passwords), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Manual acceptance checks after configuration

1. On a narrow phone, confirm the badge, Friends/Activity buttons and avatar do not overlap. Open Sign In → Forgot password? and submit a known and unknown email; both show the generic response. Retry offline and after rate limiting.
2. Request a fresh link from the intended browser/PWA and open it there. Set matching passwords, then sign in using the new password. Check mismatch, a weak password, expired/already-used links and refreshing an active form. Invalid links must offer a new request; recovery must never route to onboarding or Feed before the user exits.
3. With account B signed in, open a fresh recovery link for account A. Reset A, then Return to app: B must remain the application's account. Check recovery in separate tabs and cancellation. Never reuse a real user's credentials for this test.
4. Verify ordinary password login, registration/onboarding, Google login and a pending friend invitation still complete normally.
5. Test Android browser and installed PWA, and iPhone Safari and Home Screen PWA. OS email-link routing may open a browser instead of the installed app. PKCE needs the verifier in the same browser storage context that requested the link; if missing (another browser/device, cleared storage or a newer request), request a new link in the destination context. The app cannot force an email link into an installed PWA.

Automated tests mock Auth responses and simulate mobile layout. They do not verify real email delivery, hosted Auth settings, live SDK/network exchanges or physical Android/iPhone link routing. No SMTP, DNS or hosted Supabase changes are included.

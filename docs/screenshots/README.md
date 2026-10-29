# Local synthetic demo screenshots

| Capture | Contents |
| --- | --- |
| [Feed](feed-demo.png) | One local sober check-in and the bundled sample Feed |
| [Friends & Invites](friends-demo.png) | Username entry, loopback example invitation and sample connections |
| [Profile/calendar](profile-demo.png) | Synthetic current user, one calendar check-in and Notifications entry |

## Capture provenance and privacy

These captures show the preceding **BETA v0.1.1.0** synthetic demo, not the
prepared BETA v0.1.1.1 badge. The original images and metadata are unchanged.

Captured 2026-10-29 in installed headless **Chrome 155.0.8059.85**, at a 390×844
emulated mobile viewport. These are direct PNG captures, without generated screens,
compositing or fake device frames. They are not physical-iPhone screenshots.

The existing real-module fixture served actual application HTML, CSS and ESM on
loopback. Its config route returned three empty settings; worker routes returned
404, keeping this origin uncontrolled. A fresh profile, non-loopback page-request
blocking and disabled background networking prevented inherited sessions or backend
connections. No production requests, loaded Supabase SDK or permission prompts occurred.

One “I Didn't Drink” check-in was created through the existing demo UI with the
reason “A quiet evening and a cup of tea.” Other identities/content are bundled
samples. No real account, post, user photo or personal invitation was used. The
visible `demo-invite` URL points only to a temporary local server; it is not a
production invitation or secret. Browser storage was cleared and processes stopped.

## Artwork and publication review

The Feed capture includes **assets/demo-beer.svg**. Its legacy provenance/rights
remain an owner-review blocker: a screenshot does not clear the artwork or make it
MIT-licensed. Official identity and underlying artwork retain the exclusions in
[BRANDING.md](../../BRANDING.md) and [LICENSE](../../LICENSE).

These three proposed captures need owner approval before publication. Inclusion
grants no separate license to reserved marks or uncleared artwork. The images
have no runtime references and are excluded from the frontend build.
[Publication decisions](../open-source-readiness.md).

## Re-capture checklist

1. Use a fresh local profile and the existing [real-module fixture](../../tests/MODULE_TESTING.md).
   Force its empty config; never use production output or an existing local override.
2. Permit only loopback requests. Confirm the DEMO MODE banner, empty settings,
   no loaded SDK/connection and no controlling worker before interacting.
3. Use bundled/synthetic data and ordinary demo UI actions. No camera, notification
   or login permission is needed for portfolio captures.
4. Capture at the stated viewport; inspect visible content and URLs. Exclude
   browser profile details, real data and personal invitation tokens.
5. Inspect PNG metadata, review artwork decisions, clear storage and stop temporary
   processes. Publish only after the owner's separate review.

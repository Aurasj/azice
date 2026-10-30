# AziCe? branding and artwork

The application source code and documentation are [MIT-licensed](LICENSE).
The official AziCe? name, logo, mascot and distinctive visual identity are
reserved and excluded from that license, including all artwork in `assets/`.
Third-party components retain their own licenses.

You may refer to AziCe? by name to identify this project, credit its source or
describe a contribution. Forks and derivatives must not imply official affiliation
or endorsement. The MIT license does not grant permission to redistribute the
reserved artwork or present a separate distribution as the official AziCe? app;
seek separate permission for such use. This policy does not restrict reuse of
MIT-licensed UI code or general colors, layout techniques and functionality.
No registered-trademark status or guaranteed exclusive copyright is asserted.

## Artwork inventory and provenance

Project provenance records state that the logo and beer-mug mascot were generated specifically
for this project using ChatGPT, with no known third-party source material.
That is a maintainer-attested provenance statement, not a guarantee of legal
exclusivity or a third-party rights clearance. Derived exports remain reserved.

| Files | Origin / status |
| --- | --- |
| `assets/logo.png` | Maintainer-attested ChatGPT mascot source; remains untracked and excluded from this preparation. |
| `assets/azice-mascot-master-v2.png` | Editing master derived from that mascot; background extended with an image-editing tool while preserving the mascot core. |
| `assets/azice-pwa-192-v2.png`, `assets/azice-pwa-512-v2.png` | Standard PWA/Web Push exports from the master. |
| `assets/azice-maskable-512-v2.png` | Padded Android maskable export from the master. |
| `assets/azice-apple-touch-180-v2.png` | Apple touch export from the master. |
| `assets/azice-favicon-16-v2.png`, `assets/azice-favicon-32-v2.png` | Favicon exports from the master. |
| `assets/icon-192.png`, `assets/icon-512.png` | Legacy AC? graphics from the initial starter commit. Maintainer states these were created for AziCe? during initial development, not knowingly copied from external sources; this is not independent provenance verification. Retained for historical references and older-client URL compatibility. |
| `assets/demo-beer.svg` | Active vector demo illustration, present in the initial starter commit. The same project-created/not-knowingly-copied maintainer attestation applies; independent provenance verification is not established. Required by the demo adapter, worker cache, tests and Feed screenshot. No external image/font references were found in the SVG. |
| `docs/screenshots/*.png` | Proposed real local-demo captures. The Feed image depicts `assets/demo-beer.svg`; capture provenance does not clear the underlying artwork. Maintainer selection/publication review is pending. |

The legacy/demo graphics remain excluded from MIT. The new maintainer attestation
clarifies their origin but is not an independent rights audit. A Git
commit establishes when a file entered this repository, not its authorship or
rights. Do not infer clearance from the absence of a watermark or attribution.

[Screenshot provenance](docs/screenshots/README.md) records synthetic data and
production isolation. MIT licensing of documentation text/source does not grant
additional rights to depicted official branding or reserved artwork. The existing
LICENSE scope is unchanged; no registered-mark or exclusive-copyright claim is added.

## Creating your own distribution

1. Choose your own app name and identity. Credit the MIT code and retain LICENSE;
   a factual reference such as "based on AziCe?" must not imply endorsement.
2. Replace the reserved artwork with graphics you may distribute. Keep compatible
   sizes/paths or update references in `index.html`, `manifest.webmanifest`,
   `sw.js`, `push-sw.js` and [src/demo.js](src/demo.js). The root `demo.js`
   remains a compatibility entry point. Check any other asset references too.
   Replace the demo illustration and legacy icons as well as the mascot exports;
   omit unused authoring material from your distribution.
3. For a separate app, choose your own manifest name, identity, start URL/scope,
   deployment origin and backend configuration. Do not use the official production
   public profile for your deployment. Default local/preview builds remain demo.
   These instructions are for forks; the official app's identity stays unchanged.
4. Update branding-specific expected pixels and references to your own approved
   artwork. Preserve dimension, opacity, safe-zone, caching and packaging tests;
   do not simply remove meaningful checks. Inspect icons at home-screen sizes.

See the [documentation index](docs/README.md) for test and deployment guidance.

## Existing asset checks

The master is an opaque 600×600 square. Standard exports are 192/512px, maskable
512px, Apple 180px and favicons 16/32px. Platform PNGs are opaque RGB, with no baked
rounded mask or white corners. The maskable mascot fits the central safe circle.
Builds exclude the original source and editing master; legacy icons remain for
older installations. This documentation/screenshot work changes no runtime artwork
bytes or references.

Run `node --test tests/branding.test.mjs`: default tests pin the committed master's
203,253-pixel protected core and verify exports, safe zone and runtime references.
Optional `AZICE_BRANDING_SOURCE` enables direct comparison with an owner-held
original; the untracked source is never required or implicitly approved for commit.
Versioned URLs cannot force existing Android/iOS launchers to refresh cached icons;
test fresh installations separately when artwork changes.

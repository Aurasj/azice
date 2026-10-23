# AziCe? mascot icon assets

The approved source is `assets/logo.png` (600×600 RGBA PNG). Its outer corners are transparent, not baked-in white. Keep the source unchanged. `assets/azice-mascot-master-v2.png` is the 600×600 opaque square editing master; no text or rounded-square mask is baked into it.

The outer background was extended with the image-editing tool. The approved source was then composited back over that background: an ellipse centered at (300,295), radii (260,270), protects the mascot, with a short feather only at the outside edge. All 203,253 pixels inside its 96% core were copied exactly from the original flattened over #15171c. The foam, expression, mug, handle, hands, colors and drawing strokes are retained. No generated mascot redraw is used in the protected region. Visual review confirmed the whole mascot lies inside this region.

| Asset in `assets/` | Dimensions | Use |
| --- | --- | --- |
| `azice-pwa-192-v2.png` | 192×192 | Standard PWA icon and Web Push icon |
| `azice-pwa-512-v2.png` | 512×512 | Standard PWA icon |
| `azice-maskable-512-v2.png` | 512×512 | Android maskable icon, separate purpose |
| `azice-apple-touch-180-v2.png` | 180×180 | Apple touch icon |
| `azice-favicon-16-v2.png` | 16×16 | Browser favicon |
| `azice-favicon-32-v2.png` | 32×32 | Browser favicon |

All exports are losslessly compressed 8-bit RGB PNGs: fully opaque, square, dark in every corner, with no EXIF/ICC payload. The exports use Lanczos resizing from the master. The maskable variant scales the master to 400px, centers it on #15171c, and feathers only its background perimeter. The protected mascot ellipse maps to a maximum 180px radius, inside the 204.8px minimum safe-circle radius. The bright artwork measured at most 174.49px from center. The glow may extend beyond the safe circle; the mascot does not. No project/browser dependency was added; local post-processing used the bundled Sharp tooling.

Manifest identity, name, start URL, scope, standalone mode, existing #15171c theme/background, safe-area metadata and registration remain unchanged. The manifest URL remains `/manifest.webmanifest`. All platform references use new `-v2` filenames and the public-shell cache is bumped to `azice-shell-v2-mascot`; its old-cache cleanup and network-first behavior are retained. Web Push changes only its icon path; notification content, binding checks, routing and permissions are unchanged. Existing legacy icon files remain available for older installations/workers. The build excludes the source and authoring master, publishing only optimized exports and existing runtime assets. Neither source nor master is precached.

## Verification

`node --test tests/branding.test.mjs` decodes the PNGs without new dependencies and checks dimensions, opacity, corner colors, protected source pixels, maskable safe-zone content, stable manifest identity, HTML references, service-worker caching and private-data/push boundaries. Run the full JavaScript suite, syntax checks and `node scripts/build.mjs`, then check every manifest/HTML/service-worker reference in `dist/`.

Visual review includes the source versus master, standard/Apple/maskable icons at 48px, favicons at actual 16/32px and a minimum-safe-circle crop. The detailed mascot naturally loses fine strokes at 16px, while retaining its gold/foam silhouette. No physical Android/iPhone installation or launcher update was performed locally.

Local results: all 245 JavaScript tests (including five branding tests), 32 JavaScript syntax checks, production build and whitespace checks passed. All 16 referenced runtime paths exist in `dist/`; every built PNG matches its source export. Authoring source/master are absent from the build, and every non-icon manifest field is identical to the previous version.

## Existing installed app updates

Versioned URLs prevent old icon bytes being reused for a new request; the service-worker update makes the new shell/assets available. Neither mechanism can force a device launcher to replace an existing icon immediately. Keep the manifest URL and identity stable.

Android Chrome checks manifests and updates installed WebAPKs on its own schedule; launching then closing the installed app and later allowing normal Wi-Fi/charging time may be necessary. A launcher may continue to show its cached icon during that process. See [Chrome's manifest update behavior](https://web.dev/articles/manifest-updates).

For iOS, do not promise an automatic replacement of an already installed Home Screen icon. Test a fresh Safari → Share → Add to Home Screen installation after release. If an existing icon stays old, re-adding the Home Screen app may be required; device/browser behavior has not been verified here. Reinstallation can require signing in and enabling notifications again. [Apple's touch-icon metadata documentation](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) describes the icon link; it does not promise refresh of an existing installation.

The safe-zone rule and separate maskable purpose follow [Chrome's maskable-icon guidance](https://web.dev/articles/maskable-icon). No remote services, SQL, secrets, commits, pushes or deployments are part of this local asset update.

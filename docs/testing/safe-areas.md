# iPhone safe-area verification

> **Current reading note:** This is the retained safe-area verification record and device checklist. Original commands/counts are historical; use current checks in CONTRIBUTING.md.
> Commands assume the repository root. See the [documentation index](../README.md)
> and [deployment status](../../DEPLOY.md) before any operator action.


## Current local verification

```sh
npm test
npm run check
npm run test:sql
npm run build
node scripts/check-demo-build.mjs
node scripts/check-doc-links.mjs
```

For module/controller evidence limits see [Phase 1 testing](../../tests/MODULE_TESTING.md).
Original command blocks and counts below are retained historical evidence; prefer
the current commands above. Manual device scenarios remain acceptance checklists.


## Implementation

`index.html` already has `width=device-width, initial-scale=1, viewport-fit=cover`, Apple standalone support and the translucent status-bar setting. Those settings are preserved. Cover allows the background to fill the screen; interactive content must respect the four safe-area insets, as described in [WebKit's guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).

Only shared layout CSS changes in this fix:

- The sticky header reserves the top inset in both its height and padding. Its original 68px content area remains. Page titles, Back buttons and forms follow that header, without adding the top inset again.
- Bottom navigation grows from 78px by the bottom inset, preserving its original control area. Content clearance grows by the same amount, including on narrow phones. Friends' old extra bottom inset is removed to avoid counting it twice.
- Header, content, navigation and standalone pages protect the left/right edges in landscape.
- Camera padding owns all four insets. Its footer retains its existing 27px spacing without adding another bottom inset. Camera controls can scroll when the viewport is too short.
- Native confirmation/comment cards and the install dialog have safe viewport bounds and scrollable content. The full-photo background remains edge-to-edge; the image and Close button stay inside safe edges. Toasts also avoid the cutout.
- Normal document scrolling remains enabled. Dynamic viewport minimum heights and scroll padding provide clearance for focused fields; no keyboard positioning scripts or user-agent detection are introduced.

Zero-inset Android/desktop layouts retain their existing spacing. Photo encoding, 4:5 frames, full-photo viewing, avatar processing, navigation, authentication and Storage logic are untouched. No viewport zoom restrictions are added.

## Original local verification record

From the repository root:

```powershell
node --test tests/*.test.mjs
$safeSyntaxFiles = @(rg --files -g '*.js' -g '*.mjs' -g '!dist/**')
foreach ($safeSyntaxFile in $safeSyntaxFiles) {
  node --check $safeSyntaxFile
  if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $safeSyntaxFile" }
}
node scripts/build.mjs
```

`tests/safe-area.test.mjs` guards the viewport configuration, single ownership of each inset, navigation/content clearance, landscape padding and scrollable dialog/camera bounds. Existing photo tests remain part of the complete suite.

Verification run on 2026-10-23: **200/200 JavaScript tests passed**, syntax checks passed for **23 files**, and the production build and whitespace checks passed.

For actual browser geometry using simulated insets:

```powershell
node tests/fixtures/safe-area-browser.mjs
```

Open `http://localhost:5198/?safe=portrait&view=feed`. The fixture uses the real application source/styles and synthetic local data. It does not load Supabase/config, register a service worker or request camera permission. Stop it with Ctrl+C. It is excluded from the production build.

Supported `safe` presets are `portrait` (top 59px, bottom 34px), `landscape` (left/right 59px, bottom 21px), and `zero`. Supported `view` values are `feed`, `friends`, `profile`, `editProfile`, `new`, `camera`, `dialog`, `comment-card`, `install`, `viewer` and `auth`. A JSON assertion report appears below the page and is readable as `#safe-area-results` even when a native dialog is open.

Simulated browser checks performed:

- 390×844 with portrait insets; 844×390 with landscape insets; 390×300 with portrait insets; 320×700 and 1280×800 with zero insets.
- All 11 screens at each size: 55 page/viewport combinations and 560 passing geometry assertions, including header controls/pending dot, page titles/Back, navigation/Home-indicator clearance, horizontal overflow, dialog bounds and camera shutter reachability.
- Focused comment and profile inputs remained between the header and navigation in the 390×300 viewport. An auth input remained visible and native confirmation actions could be reached by keyboard scrolling inside the short dialog.

These are desktop-browser simulations with CSS inset overrides. They are **not** iOS Simulator or physical-iPhone tests. Shrinking a layout viewport does not fully reproduce Safari's software keyboard, visual viewport, browser chrome, safe-area reporting or standalone gestures. Real Safari and installed-PWA checks below remain necessary. [WebKit tracks keyboard/viewport differences](https://bugs.webkit.org/show_bug.cgi?id=292603).

## Exact Safari checks on a physical iPhone

Use an approved HTTPS test build containing this change. Nothing was deployed by this work. Use a test account; arrange one pending incoming friend request if the orange dot needs checking. Record iPhone model, iOS version and browser/PWA mode.

1. Open the test URL in **Safari**, in portrait, with the browser toolbar visible. Reload online so the current CSS is loaded. Confirm the brand, Friends button, orange request dot and profile button are entirely below the notch/Dynamic Island. The dark background may extend behind the system status bar; controls must not.
2. Scroll Feed down and back to the top, allowing Safari's toolbars to collapse and reappear. Confirm the sticky header stays safe. Rotate to landscape in both directions, then back to portrait. Confirm header controls, page text and navigation clear both side cutouts and no horizontal page scrolling appears.
3. Open Friends & Invites. Check its title, Back, incoming actions, invitation controls and final friend row. Scroll to the end: the last action must clear bottom navigation. Back must return to Feed; opening a friend's profile and Back must return to Friends.
4. Open Profile, Calendar and Edit Profile. Focus Username and Bio; type, move the caret and scroll while the keyboard is visible. Confirm the focused text and Save Changes can be brought into view. Dismiss the keyboard and check the header and bottom navigation return to their normal safe positions, without a persistent blank strip or clipped page. Repeat in landscape.
5. Repeat the keyboard check in Feed's comment field and the New Post reason field. Confirm the caret and relevant action remain reachable by normal scrolling. Open a comment confirmation, then **Cancel**; open a comment-author card and **Close** it. In each dialog, verify text/actions remain inside the safe area and scroll when height is limited. Profile → Install App should also show a reachable Got It button.
6. Open post creation → Take Photo. Confirm camera Close/Switch camera controls clear the cutout and the shutter clears the Home indicator in portrait and both landscape orientations. If camera access is denied, confirm the error and Close remain reachable. Allow access, switch cameras, capture and return to preview. Verify existing three-photo limits and 4:5 presentation remain.
7. Open a Feed photo and a captured/review photo. Confirm the entire image is visible with contain sizing and Close stays below/inside safe edges after rotation. Close with × and Safari Back; verify focus/page position restoration. With an external keyboard, also test Escape and Tab. Confirm normal Feed swiping still works.
8. On every page, check Feed, Create Post (+) and Profile controls sit above the Home indicator. After scrolling to the final content/action, it must remain reachable above navigation. Repeat after opening/dismissing the keyboard and returning from another app.

## Exact installed-PWA checks

1. In Safari on the same test origin, tap **Share → Add to Home Screen**. Enable **Open as Web App** if offered, then tap **Add**. If already installed, fully close and reopen it online so the updated app shell/CSS can load.
2. Launch from the Home Screen icon. Confirm it opens in standalone mode, without Safari's address bar. Repeat Safari steps 1–8, especially top padding on first launch, pending dot visibility, both landscape directions, keyboard dismissal, camera controls and full-photo Close.
3. Background the PWA, reopen it, lock/unlock the phone, and repeat a portrait/landscape rotation. Confirm safe spacing updates without duplicate top/bottom gaps and the bottom Create Post button remains accessible.

No physical iPhone, native iOS keyboard or standalone runtime was exercised automatically. No SQL, Supabase/Storage changes, commits, pushes or deployments were performed.

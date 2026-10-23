# Photo update verification

## Scope and preserved behavior

Post capture remains camera-only, with a maximum of three images. “I Drank” still requires at least one photo; “I Didn't Drink” permits none. Avatar selection still uses the gallery and retains its existing centered square presentation. The Feed carousel still uses native horizontal scrolling and snapping and retains its existing photo-count hint. Bottom navigation and its content clearance are unchanged.

Post photos are now proportional JPEGs at quality 0.80, at most 1600px on the longest edge, without upscaling or cropping. Integer rounding can change the mathematical ratio by less than a pixel. Preview and upload use the same processed blob. Canvas encoding discards source EXIF/GPS; no additional original is uploaded. Existing stored photos are not rewritten.

Feed and review images have a centered 4:5 cover presentation. A keyboard-accessible native dialog displays the complete image with contain sizing, closes with its visible button, Escape or browser Back, and restores focus. It uses the existing authenticated Storage downloads. Downloads are coalesced, loaded near the viewport and retained in a bounded, in-memory cache; object URLs are revoked on eviction, account change or page destruction. Closing a viewer retains its shared cached image to avoid another download. Removed/cancelled/published draft URLs are released. No private images are cached by the service worker.

Avatars are encoded once as JPEG at quality 0.80, at most 512×512, without upscaling. Transparent backgrounds are flattened to white. A failed profile update attempts to remove only the newly uploaded avatar. The existing post draft/publish flow, JPEG MIME type, Storage paths, RLS and account-deletion implementation are unchanged. Cleanup remains best-effort if the network or Storage deletion fails.

## Automated and browser checks

Run from the repository root:

```powershell
node --test tests/*.test.mjs
$photoSyntaxFiles = @(rg --files -g '*.js' -g '*.mjs' -g '!dist/**')
foreach ($photoSyntaxFile in $photoSyntaxFiles) {
  node --check $photoSyntaxFile
  if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $photoSyntaxFile" }
}
node scripts/build.mjs
```

The photo unit tests mock DOM, canvas, camera and Storage. They cover image dimensions and full-frame drawing, MIME/quality, preview blob reuse, three-photo/type constraints, camera errors and concurrent/late captures, camera return from the back-forward cache, avatar sizing/gallery selection, viewer close/focus/history, URL cleanup, account switching, download authorization errors and the unchanged upload/publish order. Existing tests cover post upload/publish failure cleanup, private Storage policy definitions and account-deletion cleanup. These are JavaScript tests, not live PostgreSQL/RLS verification.

The optional, isolated browser fixture uses the actual application source and styles with synthetic photos, substitutes a local API, and disables boot/config loading and service-worker registration:

```powershell
node tests/fixtures/photos-browser.mjs
```

Open `http://localhost:5197/` for Feed, `http://localhost:5197/?view=preview` for review or `http://localhost:5197/?view=capture` for captured thumbnails. Stop with Ctrl+C. The fixture intentionally includes four shapes to inspect rendering; it never uploads a post or accesses Supabase. Its report below the UI tests real canvas JPEG encoding and removal of an injected EXIF GPS block. It is excluded from the production build.

Browser checks performed in the desktop in-app browser:

- 320×700, 390×844, 430×932, 844×390 and 1280×800: all slides had the same height and a 4:5 ratio, cover sizing and no document horizontal overflow.
- Portrait, landscape, square and panoramic images: contain sizing in the viewer; visible close button, Escape, browser Back and focus restoration worked.
- Keyboard navigation moved the native carousel horizontally without changing its height. Review used the same slide renderer and opened the optimized image.
- Real JPEG outputs: 3024×4032 → 1200×1600; 4032×3024 → 1600×1200; 2048×2048 → 1600×1600; 8000×100 → 1600×20; 240×320 stayed unchanged. Injected EXIF/GPS was absent from the output JPEG.

Actual Android/iPhone cameras, hardware permissions, touch swipes, HEIC decoding and installed-PWA gestures were **not** exercised. No live Storage upload, remote RLS test or account deletion was performed. Supported avatar formats depend on the browser's image decoder; unsupported files show an English error. JPEG quality is a browser encoding hint, not a guaranteed byte size. Native dialog support is required.

## Exact Android and iPhone manual checks

Use the reviewed build on an approved **HTTPS test environment** and disposable test accounts. The deployed application has not been updated by this work. Run the shared checks once in Android Chrome and once in iPhone Safari, then repeat the camera/viewer checks in the installed PWA. Record device, OS/browser version and results.

1. **Permissions:** Sign in, tap New post, choose “I Drank”, Continue, then Take Photo. Deny camera access. Confirm an English error, a working Close button, and no gallery picker. Allow camera access in website permissions and retry. Confirm live video and working Close/Switch camera controls. Repeat after leaving and returning to the app; confirm the camera can resume or be reopened.
2. **Capture/orientation:** Capture one portrait and one landscape photo, rotating the device before each capture. Switch front/rear cameras before the third photo. Rapidly tap the shutter once as a duplicate-tap check. Confirm exactly three thumbnails, correct orientation and no fourth-photo control. Close or switch cameras while capture is processing; confirm no unexpected late photo is added.
3. **Post requirements:** Remove all photos. Confirm “I Drank” cannot continue. Cancel, choose “I Didn't Drink” and confirm it can continue with zero photos. Confirm reason validation still applies. Start a new three-photo post for the remaining checks.
4. **Preview/full image:** Tap each capture thumbnail and inspect the complete uncropped image. Close it, enter a reason and Continue to review. Confirm centered 4:5 crops, horizontal scrolling, all three photos, and no image stretching. Open each review photo and confirm that the complete frame matches the captured processed image. Close with × and confirm the page position and focus return. With a hardware keyboard, also test Tab, Enter, Escape and focus remaining inside the dialog.
5. **Publish/Feed:** Publish once. Confirm one post, the same preview crops, a stable carousel height while swiping, and the existing photo count hint. Open each photo, rotate the device, and confirm contain sizing. On Android, use system Back and Chrome Back; on iPhone Safari, use browser Back/edge-back. Each should dismiss the viewer before leaving Feed. In an installed iPhone PWA, test any available Back gesture and the visible close button. Confirm normal scrolling reaches the final Feed action above bottom navigation.
6. **Other image shapes:** Also inspect existing square and panoramic/very tall test images if available. These can be authorized fixture posts; do not enable gallery uploads for posting. Confirm full-frame viewing and a constant 4:5 Feed frame.
7. **Failure/retry:** In the approved test environment, interrupt connectivity immediately before publishing. Confirm a clear error and that the draft retains its reason and photos. Restore connectivity and retry; confirm one published post. Inspect draft/Storage cleanup after a controlled upload or publish failure. A complete loss of connectivity can prevent best-effort cleanup and needs separate follow-up.
8. **Avatars:** Edit Profile → Choose from Gallery. Select a large portrait JPEG, a landscape PNG, a small image and, if available, HEIC. Confirm gallery selection remains available, existing square avatar presentation remains, small images are not upscaled, and unsupported images fail clearly. Confirm a profile-update failure preserves the old avatar and attempts to remove the new file.
9. **Encoding/Storage:** Use Android Chrome remote debugging or Safari Web Inspector to inspect uploads. Confirm `image/jpeg`, existing `post-images/<user>/<post>/...jpg` paths, one uploaded file per photo, longest edge ≤1600 and the original aspect ratio within pixel rounding. Inspect downloaded test JPEG metadata: no original EXIF/GPS. Confirm avatars use the existing `avatars/<user>/...jpg` paths and dimensions ≤512×512. No new bucket, original copy, public URL or signed-link flow should appear.
10. **Private access/accounts:** With A and B confirmed friends, view A's photo as B. As unrelated C, use the existing authenticated Storage client to request the same object path; expect denial. Sign out B with a viewer open and sign in C; confirm it closes and A's images do not carry into C's session. Repeat account switching while a photo download is delayed. Check Friends, its pending-request indicator, comment discovery, reactions, profiles and calendar still behave normally.
11. **Deletion compatibility:** Only with a disposable account deliberately selected for deletion testing, create a photo post and avatar, then use the existing Delete Account flow. Confirm the existing Edge Function removes that account's Storage objects before deleting Auth and does not affect another account. This destructive test was not performed automatically.

No remote Supabase changes, SQL/RLS changes, commits, pushes or deployments are part of this update.

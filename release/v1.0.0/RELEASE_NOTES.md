# DownMan 1.0.0

First stable release. Consolidates the host-agnostic media resolver and cross-site
capture into a 1.0 milestone.

## Highlights

- **Exact per-video capture** — on posts that contain several videos, each player's
  poster/manifest media ID is matched to its own stream, so a post that shows a main
  video plus an embedded or related video (or several videos) downloads the one you
  clicked.
- **Automatic browser cookies** — logged-in, private, and age-restricted content works
  without extra setup; an explicit "Don't use cookies" option remains on the extension
  options page.
- **No download-bubble flash** — while interception is active, DownMan hides the
  browser's own download UI so handed-off downloads no longer flash a vanishing entry;
  it is restored when interception is off or DownMan closes.
- **Precise post binding** — a permalink is bound only within the clicked video's own
  post unit, so an embedded or related video is never attributed to the outer post; when
  a nested video exposes no permalink of its own, DownMan refuses rather than guessing.
- **Faster settings sync** — interception file types added in the app propagate to the
  extension within ~15 seconds.
- **AMO-clean Firefox package** — the Firefox build ships as an event page with the
  Chromium-only key and desktop-UI permissions stripped; the signed `.xpi` is included
  below.

See [CHANGELOG.md](../../CHANGELOG.md) for the full list.

## Downloads

| File                          | Platform                                             |
| ----------------------------- | ---------------------------------------------------- |
| `downman_1.0.0_amd64.deb`     | Linux desktop app (pulls in aria2 + ffmpeg)          |
| `downman-1.0.0-firefox.xpi`   | Firefox extension (signed, self-distribution)        |
| `downman-1.0.0-chrome.zip`    | Chrome/Chromium extension (Load unpacked)            |

## Install

**App (.deb):**

```bash
sudo apt install ./downman_1.0.0_amd64.deb
```

**Firefox extension:** open `downman-1.0.0-firefox.xpi` in Firefox and confirm the
install prompt.

**Chrome/Chromium extension:** unzip `downman-1.0.0-chrome.zip`, open
`chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.

## Checksums (SHA-256)

See `SHA256SUMS.txt`. Verify with:

```bash
sha256sum -c SHA256SUMS.txt
```

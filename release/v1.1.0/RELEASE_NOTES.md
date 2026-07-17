# DownMan 1.1.0

Power-user media and download workflows on top of the 1.0 core: reusable profiles,
paged collection review, bulk preflight, follows, backend scheduling, and a versioned
state store.

## Highlights

- **Download profiles** — reusable presets covering quality, container, codecs, FPS,
  audio, subtitles, SponsorBlock, metadata, thumbnails, chapters, clip ranges, and
  network defaults, with an active profile and an immutable per-job policy snapshot so
  queued jobs never change when a profile is later edited.
- **Collection Inspector** — review large playlists and channels in bounded pages with
  filtering, persistent selection, cancellation, and archive indicators (handles up to
  10,000 items).
- **Bulk URL preflight** — normalize and classify pasted URLs, review duplicates and
  conflicts, see optional size/ETA estimates, and commit only the selected rows.
- **Follows & search** — poll channels and playlists into a Review Inbox or opt into
  bounded auto-download, and run a paged keyword media search with selectable,
  profile-aware results.
- **Library, archive & M3U** — a first-class Library view over the media archive;
  extractor-level deduplication skips already-downloaded media on repeated imports, with
  yt-dlp archive and M3U export.
- **Backend scheduling & network overrides** — global, queue, and per-job time windows
  that keep running while the window is hidden, plus per-job proxy, headers, user-agent,
  connection, split, retry, and speed overrides.
- **More reliable feed capture** — in a busy social feed, the exact clicked video is
  captured through its own media manifest, so a quoted or embedded post's video is no
  longer downloaded instead.
- **Versioned state store** — a bundled-SQLite store backs the new workflows and
  migrates/backs up legacy state without losing followed sources.

See [CHANGELOG.md](../../CHANGELOG.md) for the full list.

## Downloads

| File                            | Platform                                             |
| ------------------------------- | ---------------------------------------------------- |
| `downman_1.1.0_amd64.deb`       | Linux desktop app (pulls in aria2 + ffmpeg)          |
| `downman_1.1.0_amd64.AppImage`  | Linux portable (install aria2 + ffmpeg yourself)     |
| `downman-1.1.0-firefox.xpi`     | Firefox extension (signed, self-distribution)        |
| `downman-1.1.0-chrome.zip`      | Chrome/Chromium extension (Load unpacked)            |

## Install

**App (.deb):**

```bash
sudo apt install ./downman_1.1.0_amd64.deb
```

**App (AppImage):** install the two runtime tools once, then run it:

```bash
sudo apt install aria2 ffmpeg
chmod +x ./downman_1.1.0_amd64.AppImage
./downman_1.1.0_amd64.AppImage
```

**Firefox extension:** open `downman-1.1.0-firefox.xpi` in Firefox and confirm the
install prompt.

**Chrome/Chromium extension:** unzip `downman-1.1.0-chrome.zip`, open
`chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.

## Checksums (SHA-256)

See `SHA256SUMS.txt`. Verify with:

```bash
sha256sum -c SHA256SUMS.txt
```

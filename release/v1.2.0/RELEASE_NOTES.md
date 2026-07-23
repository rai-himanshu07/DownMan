# DownMan 1.2.0

A security, precision, and reliability release for browser-assisted downloads: authenticated
extension pairing, exact-player MediaSource evidence, guarded source editing, URL patterns,
safer state migration, and quieter background operation.

## Highlights

- **Authenticated browser pairing** — Chromium and Firefox connectors pair once through a
  60-second user-approved window, then authenticate bridge requests with a rotatable local
  capability token. The extension popup can pause, resume, retry, open, and reveal tasks.
- **Exact-player MediaSource evidence** — a bounded page-world probe associates object URLs and
  MediaSource activity with the player that consumed them. It never captures media bodies and can
  bind only URLs independently observed by the extension's network ledger.
- **Guarded source URL editing** — paused single-file HTTP downloads can switch mirrors safely.
  Partial data is reused only when both sources prove the same strong ETag and size; otherwise a
  restart requires explicit confirmation while preserving task policy and queue metadata.
- **Bulk URL patterns** — preflight expands padded and stepped numeric ranges, letter ranges, and
  enumerations, with escaping and a hard 10,000-item safety limit.
- **Safer app state** — app-owned data moves from the download folder to
  `~/.local/share/DownMan` through an integrity-checked, non-destructive migration that keeps the
  legacy state as a backup.
- **Quieter background operation** — schedule and monitor caches remove repeated SQLite churn,
  frontend polling pauses while hidden, and completion-command children are reaped cleanly.
- **Silent login startup repaired** — enabled 1.1 autostart entries that omitted `--hidden` are
  repaired automatically, while entries explicitly disabled by the desktop remain disabled.
- **Release notifications** — DownMan checks daily for a newer app release and exposes a manual
  check in About; it never downloads or installs an app update without the user.

See [CHANGELOG.md](../../CHANGELOG.md) for the full list.

## Downloads

| File                            | Platform                                             |
| ------------------------------- | ---------------------------------------------------- |
| `downman_1.2.0_amd64.deb`       | Linux desktop app (pulls in aria2 + ffmpeg)          |
| `downman_1.2.0_amd64.AppImage`  | Linux portable (install aria2 + ffmpeg yourself)     |
| `downman-1.2.0-firefox.xpi`     | Firefox extension (signed, self-distribution)        |
| `downman-1.2.0-chrome.zip`      | Chrome/Chromium extension (Load unpacked)            |

## Upgrade Notes

- Existing app state is migrated automatically on first 1.2 launch; the old state remains
  available as a backup.
- After installing or updating the browser connector, open **DownMan → Settings → Browser**, click
  **Allow extension pairing**, then click **Pair with DownMan** in the extension popup within
  60 seconds.

## Install

**App (.deb):**

```bash
sudo apt install ./downman_1.2.0_amd64.deb
```

**App (AppImage):** install the two runtime tools once, then run it:

```bash
sudo apt install aria2 ffmpeg
chmod +x ./downman_1.2.0_amd64.AppImage
./downman_1.2.0_amd64.AppImage
```

**Firefox extension:** open `downman-1.2.0-firefox.xpi` in Firefox and confirm the
install prompt.

**Chrome/Chromium extension:** unzip `downman-1.2.0-chrome.zip`, open
`chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.

## Checksums (SHA-256)

See `SHA256SUMS.txt`. Verify with:

```bash
sha256sum -c SHA256SUMS.txt
```
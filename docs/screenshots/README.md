# Screenshots

Images referenced by the project [`README.md`](../../README.md#screenshots) live here.
Add the files below, then uncomment the image block in the README.

## Recommended shots

| File           | What to show                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `main.png`     | The downloads list mid‑transfer — ideally a mix of a torrent, a video capture, and a file, dark theme. |
| `capture.png`  | The in‑page **⤓ Download** button / quality menu on a video (a browser window).                       |
| `settings.png` | The Settings view (Appearance or Automation tab).                                                     |
| `demo.gif` _(optional)_ | A 5–10 s clip: paste or drag a link → confirm sheet → download completes.                    |

## Capturing on GNOME

```bash
# a single window (run, then click the DownMan window):
gnome-screenshot -w -d 2 -f docs/screenshots/main.png

# a short GIF — Peek is the simplest recorder:
sudo apt install peek        # record the app window, then Export as GIF
```

Tips for a clean, uniform look:

- Keep the default window size (~1180×760) and the **dark** theme.
- Have a few realistic downloads in the list (not the error rows from testing).
- Target < ~1 MB per PNG and < ~5 MB for the GIF so the repo stays light.

# Security Policy

## Supported versions

DownMan ships from a single line of development. Security fixes land on
the latest release and `main`; older builds are not maintained.

| Version                 | Supported |
| ----------------------- | --------- |
| latest `1.x` / `main`   | ✅        |
| anything older          | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately using GitHub's **“Report a vulnerability”** button on the repository's
**Security** tab (GitHub Security Advisories). Please include:

- what you found and its impact,
- steps to reproduce (a proof‑of‑concept if possible),
- the affected version / commit, and your OS + desktop environment.

You can expect an acknowledgement within a few days. Once a fix is ready we'll coordinate
a release and credit you in the advisory unless you prefer to remain anonymous.

## Security model

DownMan runs entirely on the local machine and opens only **loopback‑bound** surfaces:

- **Browser bridge** — `http://127.0.0.1:6802`, used by the companion extension to hand off
  downloads. It is **origin‑gated**: requests carrying a web‑page `Origin`
  (`http(s)://…` or `null`) are rejected, so a website cannot silently drive it.
- **aria2 JSON‑RPC** — `127.0.0.1:6810`, protected by a random per‑session secret token.
- **Remote web UI** — **off by default**; when enabled it is token‑protected and intended
  for trusted LAN use only.

The app also launches **aria2**, **yt‑dlp**, and **FFmpeg** as subprocesses and keeps
**yt‑dlp** current by downloading official releases (checksum‑verified).

### In scope

- The DownMan app (Rust core and UI) and its browser extension.
- The local bridge, RPC handling, the remote web UI, URL routing/unwrapping, and file handling.

### Out of scope

- Vulnerabilities **within** the invoked tools themselves (**aria2**, **yt‑dlp**, **FFmpeg**) —
  report those to their respective upstream projects. If DownMan *uses* them insecurely,
  that **is** in scope.
- Content you choose to download. You are responsible for the sites you access and the files
  you retrieve (see [`LICENSE`](LICENSE)).

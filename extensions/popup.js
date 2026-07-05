async function tab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}
async function endpoint() {
  const { server } = await chrome.storage.local.get("server");
  return server || "http://127.0.0.1:6802";
}
async function cookiesPref() {
  const { cookies } = await chrome.storage.local.get("cookies");
  return cookies || "";
}
async function post(payload) {
  const base = await endpoint();
  const r = await fetch(`${base}/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("DownMan offline");
}

async function fetchFormats(url) {
  const base = await endpoint();
  const r = await fetch(`${base}/formats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, referer: url, cookies: await cookiesPref() }),
  });
  if (!r.ok) throw new Error("DownMan offline");
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function flash(msg, ok = true) {
  const st = document.getElementById("st");
  st.textContent = msg;
  st.style.color = ok ? "#6ee63a" : "#f04ec0";
}

(async () => {
  const t = await tab();

  // Page capture buttons (yt-dlp) — POST directly so closing the popup can't drop it.
  document.querySelectorAll(".q").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await post({
          kind: "page",
          uris: [t.url],
          options: { format: b.dataset.f, referer: t.url, cookies: await cookiesPref() },
        });
        flash("Sent to DownMan ✓");
        setTimeout(() => window.close(), 600);
      } catch {
        flash("App offline — is DownMan running?", false);
        b.disabled = false;
      }
    };
  });

  // "Choose exact quality…" — pull the real per-video format list from the app.
  const choose = document.getElementById("choose");
  const flabel = document.getElementById("flabel");
  const ful = document.getElementById("formats");
  choose.onclick = async () => {
    choose.disabled = true;
    const prev = choose.textContent;
    choose.textContent = "Loading qualities…";
    try {
      const data = await fetchFormats(t.url);
      const formats = data.formats || [];
      ful.innerHTML = "";
      if (!formats.length) {
        flash("No formats found", false);
        choose.textContent = prev;
        choose.disabled = false;
        return;
      }
      flabel.style.display = "block";
      choose.style.display = "none";
      formats.forEach((f) => {
        const li = document.createElement("li");
        const tag = f.kind === "audio" ? "♪ " : "";
        li.textContent = tag + f.label;
        li.onclick = async () => {
          try {
            await post({ kind: "page", uris: [t.url], options: { format: f.selector, referer: t.url, cookies: await cookiesPref() } });
            flash("Sent to DownMan ✓");
            setTimeout(() => window.close(), 600);
          } catch {
            flash("App offline", false);
          }
        };
        ful.appendChild(li);
      });
    } catch (e) {
      flash(String(e).includes("offline") ? "App offline" : "Could not read formats", false);
      choose.textContent = prev;
      choose.disabled = false;
    }
  };

  // "Grab files from this page…" — open the Site Grabber in the app, prefilled.
  const grabsite = document.getElementById("grabsite");
  if (grabsite) {
    grabsite.onclick = async () => {
      grabsite.disabled = true;
      try {
        const base = await endpoint();
        await fetch(`${base}/grab`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: t.url }) });
        flash("Opening Site Grabber ✓");
        setTimeout(() => window.close(), 600);
      } catch {
        flash("App offline — is DownMan running?", false);
        grabsite.disabled = false;
      }
    };
  }

  // Quick toggle: auto-capture downloads from the browser.
  const intercept = document.getElementById("intercept");
  if (intercept) {
    chrome.storage.local.get("intercept").then(({ intercept: i }) => { intercept.checked = i === true; });
    intercept.onchange = () => chrome.storage.local.set({ intercept: intercept.checked });
  }

  // Live downloads mini-view (polls the local bridge).
  async function loadDownloads() {
    try {
      const base = await endpoint();
      const r = await fetch(`${base}/list`);
      const d = await r.json();
      const items = (d.downloads || []).filter((x) => x.status === "active" || x.status === "waiting" || x.status === "paused");
      const ul = document.getElementById("downloads");
      const lab = document.getElementById("dlabel");
      if (!items.length) { lab.style.display = "none"; ul.innerHTML = ""; return; }
      lab.style.display = "block";
      ul.innerHTML = "";
      items.slice(0, 6).forEach((x) => {
        const pct = +x.total > 0 ? Math.min(100, (100 * x.done) / x.total) : 0;
        const li = document.createElement("li");
        li.style.cursor = "default";
        const nm = (x.name || "").replace(/[&<>]/g, "");
        li.innerHTML = `<div style="display:flex;justify-content:space-between"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px">${nm}</span><span style="color:#64748b">${pct.toFixed(0)}%</span></div><div style="height:3px;background:#2a3050;border-radius:9px;margin-top:3px"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#1f93ff,#f04ec0);border-radius:9px"></div></div>`;
        ul.appendChild(li);
      });
    } catch { /* offline */ }
  }
  loadDownloads();
  setInterval(loadDownloads, 1500);

  // Detected direct streams (sniffer)
  chrome.runtime.sendMessage({ dm: "list", tabId: t.id }, (items = []) => {
    if (chrome.runtime.lastError) items = [];
    document.getElementById("st").textContent = `${items.length} streams`;
    if (!items.length) return;
    document.getElementById("mlabel").style.display = "block";
    const ul = document.getElementById("media");
    items.forEach((m) => {
      const li = document.createElement("li");
      li.textContent = (m.url.split("/").pop() || m.url).slice(0, 44);
      li.onclick = async () => {
        try {
          await post({ kind: "stream", uris: [m.url], options: { referer: t.url, cookies: await cookiesPref() } });
          flash("Sent to DownMan ✓");
          setTimeout(() => window.close(), 600);
        } catch {
          flash("App offline", false);
        }
      };
      ul.appendChild(li);
    });
  });
})();

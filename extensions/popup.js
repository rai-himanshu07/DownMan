async function tab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}
async function endpoint() {
  const { server } = await chrome.storage.local.get("server");
  return server || "http://127.0.0.1:6802";
}
function flash(msg, ok = true) {
  const st = document.getElementById("st");
  st.textContent = msg;
  st.style.color = ok ? "#6ee63a" : "#f04ec0";
  document.getElementById("dot").style.background = ok ? "#6ee63a" : "#f04ec0";
}

(async () => {
  const t = await tab();

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
    try {
      const base = await endpoint();
      const response = await fetch(`${base}/rules`);
      const captureRules = await response.json();
      intercept.checked = captureRules.enabled !== false;
    } catch {
      intercept.checked = true;
    }
    intercept.onchange = async () => {
      try {
        const base = await endpoint();
        const response = await fetch(`${base}/rules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: intercept.checked }),
        });
        if (!response.ok) throw new Error("save failed");
        chrome.runtime.sendMessage({ dm: "rules-changed" }, () => void chrome.runtime.lastError);
      } catch {
        intercept.checked = !intercept.checked;
        flash("Could not save — is DownMan running?", false);
      }
    };
  }

  // Live downloads mini-view (polls the local bridge).
  async function loadDownloads() {
    try {
      const base = await endpoint();
      const r = await fetch(`${base}/list`);
      if (!r.ok) throw new Error("offline");
      const d = await r.json();
      flash("Connected");
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
    } catch { flash("Offline", false); }
  }
  loadDownloads();
  setInterval(loadDownloads, 1500);

})();

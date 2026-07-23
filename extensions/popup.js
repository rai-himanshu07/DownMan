async function tab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}
async function endpoint() {
  const { server } = await chrome.storage.local.get("server");
  return server || "http://127.0.0.1:6802";
}
async function bridgeFetch(path, options = {}) {
  const [base, stored] = await Promise.all([endpoint(), chrome.storage.local.get("bridgeToken")]);
  const headers = { ...(options.headers || {}) };
  if (stored.bridgeToken) headers["X-DownMan-Token"] = stored.bridgeToken;
  return fetch(`${base}${path}`, { ...options, headers });
}
function flash(msg, ok = true) {
  const st = document.getElementById("st");
  st.textContent = msg;
  st.style.color = ok ? "#6ee63a" : "#f04ec0";
  document.getElementById("dot").style.background = ok ? "#6ee63a" : "#f04ec0";
}

(async () => {
  const t = await tab();
  const pair = document.getElementById("pair");

  function requirePairing(message = "Pairing required") {
    pair.style.display = "block";
    flash(message, false);
  }

  pair.onclick = async () => {
    pair.disabled = true;
    try {
      const base = await endpoint();
      const response = await fetch(`${base}/pair`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) throw new Error(data.error || "Pairing failed");
      await chrome.storage.local.set({ bridgeToken: data.token });
      pair.style.display = "none";
      flash("Paired ✓");
      await loadDownloads();
    } catch (error) {
      requirePairing(String(error).replace(/^Error:\s*/, ""));
    } finally {
      pair.disabled = false;
    }
  };

  // "Grab files from this page…" — open the Site Grabber in the app, prefilled.
  const grabsite = document.getElementById("grabsite");
  if (grabsite) {
    grabsite.onclick = async () => {
      grabsite.disabled = true;
      try {
        const response = await bridgeFetch("/grab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: t.url }) });
        if (response.status === 401) throw new Error("Pairing required");
        if (!response.ok) throw new Error("DownMan rejected the request");
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
      const response = await bridgeFetch("/rules");
      if (response.status === 401) throw new Error("Pairing required");
      const captureRules = await response.json();
      intercept.checked = captureRules.enabled !== false;
    } catch (error) {
      if (String(error).includes("Pairing required")) requirePairing();
      intercept.checked = true;
    }
    intercept.onchange = async () => {
      try {
        const response = await bridgeFetch("/rules", {
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
  async function sendAction(gid, action) {
    const response = await bridgeFetch("/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gid, action }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "Action failed");
    await loadDownloads();
  }

  function actionButton(symbol, label, gid, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = symbol;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.onclick = async () => {
      button.disabled = true;
      try {
        await sendAction(gid, action);
        flash(`${label} ✓`);
      } catch (error) {
        flash(String(error).replace(/^Error:\s*/, ""), false);
      } finally {
        button.disabled = false;
      }
    };
    return button;
  }

  async function loadDownloads() {
    try {
      const r = await bridgeFetch("/list");
      if (r.status === 401) {
        requirePairing();
        return;
      }
      if (!r.ok) throw new Error("offline");
      const d = await r.json();
      pair.style.display = "none";
      flash("Connected");
      const items = (d.downloads || []).filter((x) => ["active", "waiting", "paused", "error", "complete"].includes(x.status));
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
        const actions = document.createElement("div");
        actions.className = "actions";
        if (x.status === "active" || x.status === "waiting") actions.appendChild(actionButton("Ⅱ", "Pause", x.gid, "pause"));
        if (x.status === "paused") actions.appendChild(actionButton("▶", "Resume", x.gid, "resume"));
        if (x.status === "error") actions.appendChild(actionButton("↻", "Retry", x.gid, "retry"));
        if (x.status === "complete") {
          actions.appendChild(actionButton("↗", "Open", x.gid, "open"));
          actions.appendChild(actionButton("▣", "Show in folder", x.gid, "reveal"));
        }
        if (actions.childElementCount) li.appendChild(actions);
        ul.appendChild(li);
      });
    } catch { flash("Offline", false); }
  }
  loadDownloads();
  setInterval(loadDownloads, 1500);

})();

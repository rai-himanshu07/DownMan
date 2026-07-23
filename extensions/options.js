const s = document.getElementById("server");
const i = document.getElementById("intercept");
const c = document.getElementById("cookies");
const pair = document.getElementById("pair");
const pairStatus = document.getElementById("pair-status");
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

chrome.storage.local.get(["server", "cookies"]).then(async (v) => {
  s.value = v.server || "http://127.0.0.1:6802";
  c.value = v.cookies || "auto";
  try {
    const response = await bridgeFetch("/rules");
    if (response.status === 401) throw new Error("Pairing required");
    const rules = await response.json();
    i.checked = rules.enabled !== false;
    pairStatus.textContent = "Connected";
  } catch (error) {
    pairStatus.textContent = String(error).replace(/^Error:\s*/, "");
    i.checked = true;
  }
});
s.onchange = () => chrome.storage.local.set({ server: s.value, bridgeToken: "" });
pair.onclick = async () => {
  pair.disabled = true;
  pairStatus.textContent = "Pairing…";
  try {
    const base = await endpoint();
    const response = await fetch(`${base}/pair`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token) throw new Error(data.error || "Pairing failed");
    await chrome.storage.local.set({ bridgeToken: data.token });
    pairStatus.textContent = "Paired ✓";
  } catch (error) {
    pairStatus.textContent = String(error).replace(/^Error:\s*/, "");
  } finally {
    pair.disabled = false;
  }
};
i.onchange = async () => {
  try {
    const response = await bridgeFetch("/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: i.checked }),
    });
    if (!response.ok) throw new Error("save failed");
    chrome.runtime.sendMessage({ dm: "rules-changed" }, () => void chrome.runtime.lastError);
  } catch {
    i.checked = !i.checked;
  }
};
c.onchange = () => chrome.storage.local.set({ cookies: c.value });

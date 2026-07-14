const s = document.getElementById("server");
const i = document.getElementById("intercept");
const c = document.getElementById("cookies");
async function endpoint() {
  const { server } = await chrome.storage.local.get("server");
  return server || "http://127.0.0.1:6802";
}

chrome.storage.local.get(["server", "cookies"]).then(async (v) => {
  s.value = v.server || "http://127.0.0.1:6802";
  c.value = v.cookies || "auto";
  try {
    const response = await fetch(`${s.value}/rules`);
    const rules = await response.json();
    i.checked = rules.enabled !== false;
  } catch {
    i.checked = true;
  }
});
s.onchange = () => chrome.storage.local.set({ server: s.value });
i.onchange = async () => {
  try {
    const base = await endpoint();
    const response = await fetch(`${base}/rules`, {
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

const s = document.getElementById("server");
const i = document.getElementById("intercept");
const c = document.getElementById("cookies");
chrome.storage.local.get(["server", "intercept", "cookies"]).then((v) => {
  s.value = v.server || "http://127.0.0.1:6802";
  i.checked = v.intercept === true;
  c.value = v.cookies || "";
});
s.onchange = () => chrome.storage.local.set({ server: s.value });
i.onchange = () => chrome.storage.local.set({ intercept: i.checked });
c.onchange = () => chrome.storage.local.set({ cookies: c.value });

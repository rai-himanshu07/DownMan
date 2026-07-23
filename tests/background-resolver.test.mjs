import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

await import("../extensions/media-resolver.js");
const resolver = globalThis.DownManMediaResolver;
const backgroundSource = await readFile(new URL("../extensions/background.js", import.meta.url), "utf8");

function browserWorker(session = {}, options = {}) {
  const listeners = {
    beforeRequest: [],
    downloadChanged: [],
    downloadCreated: [],
    downloadFilename: [],
    headersReceived: [],
    messages: [],
    storageChanged: [],
    tabRemoved: [],
  };
  const posted = [];
  const cancelled = [];
  const erased = [];
  const paused = [];
  const resumed = [];
  const actions = [];
  const requests = [];
  const uiOptions = [];
  let runtimeLastError = null;
  let lastErrorReads = 0;
  const event = (bucket) => ({
    addListener(listener) {
      if (bucket) listeners[bucket].push(listener);
    },
  });
  const chrome = {
    action: { setBadgeText() {} },
    contextMenus: {
      create() {},
      removeAll(callback) { callback(); },
      onClicked: event(),
    },
    downloads: {
      async cancel(id) {
        cancelled.push(id);
        actions.push(`cancel:${id}`);
        if (options.cancelFails) throw new Error("cancel failed");
      },
      pause(id, callback) {
        paused.push(id);
        actions.push(`pause:${id}`);
        if (options.callbackPauseError) {
          runtimeLastError = { message: "Download must be in progress" };
          callback?.();
          runtimeLastError = null;
          return undefined;
        }
        if (options.pauseFails) return Promise.reject(new Error("already complete"));
        return Promise.resolve();
      },
      async resume(id) { resumed.push(id); actions.push(`resume:${id}`); },
      async erase(query) { erased.push(query); actions.push(`erase:${query.id}`); return [query.id]; },
      setUiOptions(uiOption, callback) {
        uiOptions.push(uiOption);
        if (options.uiRestoreFailsOnce && uiOptions.length === 1) {
          runtimeLastError = { message: "temporary UI failure" };
          callback?.();
          runtimeLastError = null;
          return;
        }
        callback?.();
      },
      async search(query) {
        actions.push(`search:${query.id}`);
        return options.downloads?.filter((item) => item.id === query.id) || [];
      },
      onChanged: event("downloadChanged"),
      onCreated: event("downloadCreated"),
      onDeterminingFilename: event("downloadFilename"),
    },
    notifications: { create() {} },
    runtime: {
      get lastError() { lastErrorReads += 1; return runtimeLastError; },
      set lastError(value) { runtimeLastError = value; },
      onInstalled: event(),
      onMessage: event("messages"),
    },
    storage: {
      onChanged: event("storageChanged"),
        local: {
        async get(keys) {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.filter((name) => name in (options.local || {})).map((name) => [name, options.local[name]]));
        },
        async set() {},
      },
      session: {
        async get(key) { return { [key]: session[key] }; },
        async set(value) { Object.assign(session, value); },
      },
    },
    tabs: {
      onRemoved: event("tabRemoved"),
      sendMessage() {},
    },
    webRequest: {
      onBeforeRequest: event("beforeRequest"),
      onHeadersReceived: event("headersReceived"),
    },
  };
  const context = vm.createContext({
    AbortController,
    chrome,
    console,
    URL,
    DownManMediaResolver: resolver,
    clearTimeout,
    fetch: async (url, init = {}) => {
      requests.push({ url: String(url), headers: { ...(init.headers || {}) } });
      if (String(url).endsWith("/rules")) {
        if (options.offline) throw new Error("app offline");
        const fallback = { enabled: true, autoExts: ["ZIP", "EXE", "MD"], blockSites: [], blockAddresses: [] };
        return { ok: true, async json() { return structuredClone(options.rules || fallback); } };
      }
      if (options.hangAdd) {
        return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      }
      posted.push(JSON.parse(init.body));
      actions.push("post");
      return { ok: true, async json() { return { ok: true }; } };
    },
    setTimeout,
    structuredClone,
  });
  const source = options.bridgeTimeoutMs
    ? backgroundSource.replace("const BRIDGE_REQUEST_TIMEOUT_MS = 15000;", `const BRIDGE_REQUEST_TIMEOUT_MS = ${options.bridgeTimeoutMs};`)
    : backgroundSource;
  vm.runInContext(source, context, { filename: "background.js" });

  async function message(message, sender) {
    return new Promise((resolve, reject) => {
      const listener = listeners.messages[0];
      const timeout = setTimeout(() => reject(new Error(`message timed out: ${message.dm}`)), 1000);
      listener(message, sender, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  return { actions, cancelled, erased, lastErrorReads: () => lastErrorReads, listeners, message, paused, posted, requests, resumed, session, uiOptions };
}

async function waitFor(check, message) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

function intent(mediaId, triggeredAt) {
  return {
    schemaVersion: 2,
    intentId: `${mediaId}-${triggeredAt}`,
    mediaId,
    trigger: "playing",
    triggeredAt,
    frameUrl: "https://page.test/feed",
    topUrl: "https://page.test/feed",
    referer: "https://page.test/feed",
    element: "video",
    currentSrc: "blob:https://page.test/player",
    sourceKind: "blob",
    playing: true,
    viewportArea: 240000,
  };
}

function mediaResponse(url, tabId = 7, frameId = 0) {
  return {
    tabId,
    frameId,
    url,
    type: "media",
    documentUrl: "https://page.test/feed",
    initiator: "https://page.test",
    responseHeaders: [
      { name: "content-type", value: "video/mp4" },
      { name: "content-length", value: String(12 * 1024 * 1024) },
    ],
  };
}

function browserDownload(overrides = {}) {
  return {
    id: 41,
    url: "https://files.test/archive.zip",
    finalUrl: "https://files.test/archive.zip",
    filename: "/tmp/archive.zip",
    referrer: "",
    fileSize: -1,
    totalBytes: -1,
    state: "in_progress",
    startTime: new Date().toISOString(),
    ...overrides,
  };
}

test("worker correlates the clicked player instead of choosing newer same-frame media", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 7 }, frameId: 0 };
  const firstObservedAt = Date.now();

  await worker.message({ dm: "media-observed", intent: intent("media-one", firstObservedAt) }, sender);
  worker.listeners.headersReceived[0](mediaResponse("https://cdn.test/one?token=raw-one"));

  await worker.message({ dm: "media-observed", intent: intent("media-two", Date.now()) }, sender);
  worker.listeners.headersReceived[0](mediaResponse("https://cdn.test/two?token=raw-two"));

  const result = await worker.message({
    dm: "media-intent",
    intent: { ...intent("media-one", Date.now()), trigger: "button" },
  }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted.length, 1);
  assert.equal(worker.posted[0].kind, "media");
  assert.equal(worker.posted[0].schemaVersion, 2);
  assert.equal(worker.posted[0].candidates[0].url, "https://cdn.test/one?token=raw-one");
  assert.ok(worker.posted[0].candidates[0].reasons.includes("same-media-session"));
  assert.ok(!worker.posted[0].candidates[1].reasons.includes("same-media-session"));
});

test("paired worker sends its capability token on bridge requests", async () => {
  const worker = browserWorker({}, { local: { bridgeToken: "paired-token" } });
  const sender = { tab: { id: 31 }, frameId: 0 };
  const directUrl = "https://cdn.test/exact-video.mp4";

  const result = await worker.message({
    dm: "media-intent",
    intent: {
      ...intent("paired-media", Date.now()),
      currentSrc: directUrl,
      sourceKind: "http",
      contextKind: "document",
      trigger: "button",
    },
  }, sender);

  assert.equal(result.ok, true);
  const addRequest = worker.requests.find((request) => request.url.endsWith("/add"));
  assert.ok(addRequest);
  assert.equal(addRequest.headers["X-DownMan-Token"], "paired-token");
});

test("MSE ownership binds only an observed candidate to the clicked player", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 29 }, frameId: 0 };
  const clickedUrl = "https://video.cdn.test/clicked/master.m3u8?token=raw-one";
  const neighbourUrl = "https://video.cdn.test/neighbour/master.m3u8?token=raw-two";
  const unobservedUrl = "https://video.cdn.test/not-in-webrequest/master.m3u8";

  await worker.message({ dm: "media-observed", intent: intent("media-one", Date.now()) }, sender);
  await worker.message({ dm: "media-observed", intent: intent("media-two", Date.now()) }, sender);
  for (const url of [clickedUrl, neighbourUrl]) {
    worker.listeners.headersReceived[0]({
      ...mediaResponse(url, 29, 0),
      responseHeaders: [{ name: "content-type", value: "application/x-mpegURL" }],
    });
  }

  const result = await worker.message({
    dm: "media-intent",
    intent: {
      ...intent("media-one", Date.now()),
      frameUrl: "https://social.test/home",
      topUrl: "https://social.test/home",
      feedContext: true,
      contextKind: "collection",
      trigger: "button",
      mseEvidence: [
        { url: clickedUrl, contentType: "video/mp4; codecs=avc1", observedAt: Date.now() },
        { url: unobservedUrl, contentType: "video/mp4", observedAt: Date.now() },
      ],
    },
  }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted.length, 1);
  const payload = worker.posted[0];
  const selected = payload.candidates[payload.selectedIndex];
  assert.equal(selected.url, clickedUrl);
  assert.equal(selected.mseOwned, true);
  assert.ok(selected.mediaIds.includes("media-one"));
  assert.ok(!payload.candidates.some((candidate) => candidate.url === unobservedUrl));
});

test("concurrent players keep unbound streams from auto-downloading", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 14 }, frameId: 0 };
  await worker.message({ dm: "media-observed", intent: intent("media-one", Date.now()) }, sender);
  await worker.message({ dm: "media-observed", intent: intent("media-two", Date.now()) }, sender);
  worker.listeners.headersReceived[0]({
    ...mediaResponse("https://video.cdn.test/avc1/640x360/only.m3u8", 14, 0),
    responseHeaders: [{ name: "content-type", value: "application/x-mpegURL" }],
  });

  const result = await worker.message({
    dm: "media-intent",
    intent: { ...intent("media-one", Date.now()), frameUrl: "https://social.test/home", topUrl: "https://social.test/home", feedContext: true, ownerMediaCount: 1, trigger: "button" },
  }, sender);

  assert.equal(result.code, "ambiguous-player");
  assert.match(result.error, /Open .*post/i);
  assert.equal(worker.posted.length, 0);
});

test("media recorded after navigation survives a worker restart", async () => {
  const session = {};
  const firstWorker = browserWorker(session);
  const sender = { tab: { id: 7 }, frameId: 0 };

  await firstWorker.message({ dm: "media-observed", intent: intent("media-one", Date.now()) }, sender);
  firstWorker.listeners.beforeRequest[0]({ tabId: 7, type: "main_frame" });
  await firstWorker.message({ dm: "media-observed", intent: intent("media-two", Date.now()) }, sender);
  firstWorker.listeners.headersReceived[0](mediaResponse("https://cdn.test/after-navigation?token=raw"));
  await new Promise((resolve) => setTimeout(resolve, 300));

  const restartedWorker = browserWorker(session);
  const result = await restartedWorker.message({
    dm: "media-intent",
    intent: { ...intent("media-two", Date.now()), trigger: "button" },
  }, sender);

  assert.equal(result.ok, true);
  assert.equal(restartedWorker.posted[0].candidates[0].url, "https://cdn.test/after-navigation?token=raw");
});

test("default rules capture a ZIP browser download", async () => {
  const worker = browserWorker();
  worker.listeners.downloadCreated[0](browserDownload({
    url: "https://dl.test/platform-tools-latest-linux.zip",
    finalUrl: "https://dl.test/platform-tools-latest-linux.zip",
    filename: "/tmp/platform-tools-latest-linux.zip",
    referrer: "https://developer.test/",
  }));

  await waitFor(() => worker.posted.length === 1, "ZIP download was not captured");
  assert.deepEqual(worker.cancelled, [41]);
  assert.deepEqual(worker.paused, [41]);
  assert.deepEqual(worker.actions.filter((action) => action !== "search:41"), ["pause:41", "post", "cancel:41", "erase:41"]);
  assert.deepEqual(worker.posted[0].uris, ["https://dl.test/platform-tools-latest-linux.zip"]);
  assert.equal(worker.posted[0].kind, "browser");
  assert.equal(worker.posted[0].options.filename, "platform-tools-latest-linux.zip");
});

test("configured JSON is captured with the browser-resolved filename", async () => {
  const worker = browserWorker({}, {
    rules: { enabled: true, autoExts: ["JSON"], blockSites: [], blockAddresses: [] },
  });
  worker.listeners.downloadCreated[0](browserDownload({
    id: 61,
    url: "https://api.test/export?id=7",
    finalUrl: "https://api.test/export?id=7",
    filename: "/tmp/report.json",
    fileSize: 4096,
    totalBytes: 4096,
  }));

  await waitFor(() => worker.posted.length === 1, "JSON download was not captured");
  assert.equal(worker.posted[0].kind, "browser");
  assert.equal(worker.posted[0].options.filename, "report.json");
  assert.deepEqual(worker.cancelled, [61]);
});

test("small extensionless download remains entirely browser-owned", async () => {
  const worker = browserWorker();
  worker.listeners.downloadCreated[0](browserDownload({
    id: 62,
    url: "https://files.test/download",
    finalUrl: "https://files.test/download",
    filename: "/tmp/download",
    fileSize: 4096,
    totalBytes: 4096,
  }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(worker.paused, []);
  assert.deepEqual(worker.cancelled, []);
  assert.equal(worker.posted.length, 0);
});

test("offline rules fail open without pausing a configured download", async () => {
  const worker = browserWorker({}, { offline: true });
  worker.listeners.downloadCreated[0](browserDownload({ id: 63 }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(worker.paused, []);
  assert.deepEqual(worker.cancelled, []);
  assert.equal(worker.posted.length, 0);
});

test("hung bridge handoff releases the filename hook and resumes the browser", async () => {
  const worker = browserWorker({}, { hangAdd: true, bridgeTimeoutMs: 20 });
  let suggested = 0;
  worker.listeners.downloadFilename[0](browserDownload({ id: 64 }), () => { suggested += 1; });
  await waitFor(() => suggested === 1, "filename hook stayed held after bridge timeout");

  assert.deepEqual(worker.paused, [64]);
  assert.deepEqual(worker.resumed, [64]);
  assert.deepEqual(worker.cancelled, []);
});

test("changing the endpoint invalidates cached interception rules", async () => {
  const activeRules = { enabled: true, autoExts: ["ZIP"], blockSites: [], blockAddresses: [] };
  const worker = browserWorker({}, { rules: activeRules });
  worker.listeners.downloadCreated[0](browserDownload({ id: 65 }));
  await waitFor(() => worker.posted.length === 1, "initial ZIP was not captured");

  activeRules.autoExts = ["JSON"];
  worker.listeners.storageChanged[0]({ server: { oldValue: "http://old", newValue: "http://new" } }, "local");
  worker.listeners.downloadCreated[0](browserDownload({
    id: 66,
    url: "https://api.test/data",
    finalUrl: "https://api.test/data",
    filename: "/tmp/data.json",
    fileSize: 1024,
    totalBytes: 1024,
  }));
  await waitFor(() => worker.posted.length === 2, "new endpoint rules were not fetched");
  assert.equal(worker.posted[1].options.filename, "data.json");
});

test("a download UI hidden by an earlier build is restored on startup", async () => {
  const worker = browserWorker({}, { local: { dmHideDownloadUi: true } });
  await waitFor(() => worker.uiOptions.some((option) => option.enabled === true), "a previously hidden download UI should be restored");
  assert.equal(worker.uiOptions.some((option) => option.enabled === false), false, "DownMan must never hide the download UI");
});

test("a transient download UI restore failure is retried", async () => {
  const worker = browserWorker({}, { local: { dmHideDownloadUi: true }, uiRestoreFailsOnce: true });
  await waitFor(() => worker.uiOptions.length === 1, "initial UI restore was not attempted");
  worker.listeners.downloadCreated[0](browserDownload({ id: 67 }));
  await waitFor(() => worker.uiOptions.length === 2, "UI restore was not retried");
  assert.deepEqual(worker.uiOptions.map((option) => option.enabled), [true, true]);
});

test("the browser download UI is left untouched when DownMan never hid it", async () => {
  const worker = browserWorker({}, { rules: { enabled: true, autoExts: ["ZIP"], blockSites: [], blockAddresses: [] } });
  worker.listeners.downloadCreated[0](browserDownload({
    id: 60,
    url: "https://dl.test/pack.zip",
    finalUrl: "https://dl.test/pack.zip",
    filename: "/tmp/pack.zip",
    referrer: "",
  }));
  await waitFor(() => worker.posted.length === 1, "download was not captured");
  assert.deepEqual(worker.uiOptions, [], "DownMan must not toggle the download UI on a fresh install");
});

test("onChanged captures an EXE after its redirect and filename resolve", async () => {
  const downloads = [browserDownload({
    id: 42,
    url: "https://download.test/start",
    finalUrl: "https://cdn.test/setup.exe",
    filename: "/tmp/setup.exe",
    referrer: "https://download.test/",
    fileSize: -1,
  })];
  const worker = browserWorker({}, { downloads });
  worker.listeners.downloadCreated[0]({ ...downloads[0], finalUrl: "https://download.test/start", filename: "/tmp/download" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  worker.listeners.downloadChanged[0]({ id: 42, finalUrl: { current: downloads[0].finalUrl }, filename: { current: downloads[0].filename } });

  await waitFor(() => worker.posted.length === 1, "redirected EXE download was not captured");
  assert.deepEqual(worker.cancelled, [42]);
  assert.deepEqual(worker.posted[0].uris, ["https://cdn.test/setup.exe"]);
});

test("manually configured extensions are case-insensitive and may include a dot", async () => {
  const worker = browserWorker({}, {
    rules: { enabled: true, autoExts: [".custom"], blockSites: [], blockAddresses: [] },
  });
  worker.listeners.downloadCreated[0](browserDownload({
    id: 43,
    url: "https://files.test/package.CUSTOM",
    finalUrl: "https://files.test/package.CUSTOM",
    filename: "/tmp/package.CUSTOM",
    referrer: "",
    fileSize: -1,
  }));

  await waitFor(() => worker.posted.length === 1, "custom extension was not captured");
  assert.deepEqual(worker.cancelled, [43]);
});

test("a nearby semantic page leads the bundle when media responses are fragments", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 7 }, frameId: 0 };
  const mediaIntent = {
    ...intent("media-one", Date.now()),
    trigger: "button",
    pageUrls: [{ url: "https://page.test/post/abc12345", strength: 28, bound: true }],
  };
  const fragment = mediaResponse("https://cdn.test/video?bytestart=0&byteend=999");
  fragment.statusCode = 206;
  fragment.responseHeaders.push({ name: "content-range", value: "bytes 0-999/5000000" });
  await worker.message({ dm: "media-observed", intent: mediaIntent }, sender);
  worker.listeners.headersReceived[0](fragment);

  const result = await worker.message({ dm: "media-intent", intent: mediaIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted[0].candidates[0].url, "https://page.test/post/abc12345/");
  assert.ok(worker.posted[0].candidates.every((candidate) => !candidate.partial));
});

test("successful handoff remains deduplicated when browser cancellation fails", async () => {
  const item = browserDownload({
    id: 44,
    url: "https://files.test/archive.zip",
    finalUrl: "https://files.test/archive.zip",
    filename: "/tmp/archive.zip",
    referrer: "",
    fileSize: -1,
  });
  const worker = browserWorker({}, { cancelFails: true, downloads: [item] });
  worker.listeners.downloadCreated[0](item);
  await waitFor(() => worker.posted.length === 1, "handoff was not posted");
  worker.listeners.downloadChanged[0]({ id: 44, filename: { current: item.filename } });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(worker.posted.length, 1);
  assert.deepEqual(worker.cancelled, [44]);
});

test("browser restart events cannot capture completed or old history", async () => {
  const old = browserDownload({
    id: 45,
    state: "complete",
    endTime: new Date().toISOString(),
    startTime: new Date(Date.now() - 86_400_000).toISOString(),
  });
  const worker = browserWorker({}, { downloads: [old] });
  worker.listeners.downloadCreated[0](old);
  worker.listeners.downloadChanged[0]({ id: 45, exists: { current: true } });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(worker.posted.length, 0);
  assert.equal(worker.actions.some((action) => action.startsWith("search:")), false);
});

test("filename hook holds Chromium download until handoff and cancellation finish", async () => {
  const worker = browserWorker();
  let suggested = 0;
  const returned = worker.listeners.downloadFilename[0](browserDownload({ id: 46 }), () => { suggested += 1; });
  assert.equal(returned, true);
  await waitFor(() => suggested === 1, "filename hook did not release");

  assert.deepEqual(worker.paused, [46]);
  assert.deepEqual(worker.actions, ["pause:46", "post", "cancel:46", "erase:46"]);
});

test("tiny Markdown is handed off while Chromium filename finalization is held", async () => {
  const worker = browserWorker({}, { pauseFails: true });
  let suggested = 0;
  const item = browserDownload({
    id: 49,
    url: "https://github.test/project/raw/main/CHANGELOG.md",
    finalUrl: "https://github.test/project/raw/main/CHANGELOG.md",
    filename: "/tmp/CHANGELOG.md",
    fileSize: 4096,
    totalBytes: 4096,
  });
  worker.listeners.downloadFilename[0](item, () => { suggested += 1; });
  await waitFor(() => suggested === 1, "tiny Markdown filename hook did not finish");

  assert.equal(worker.posted.length, 1);
  assert.deepEqual(worker.cancelled, [49]);
  assert.deepEqual(worker.actions, ["pause:49", "post", "cancel:49", "erase:49"]);
});

test("callback runtime.lastError from late pause is consumed without console leakage", async () => {
  const worker = browserWorker({}, { callbackPauseError: true });
  let suggested = 0;
  worker.listeners.downloadFilename[0](browserDownload({ id: 52 }), () => { suggested += 1; });
  await waitFor(() => suggested === 1, "callback-error filename hook did not finish");

  assert.equal(worker.lastErrorReads(), 1);
  assert.equal(worker.posted.length, 1);
  assert.deepEqual(worker.cancelled, [52]);
  assert.deepEqual(worker.actions, ["pause:52", "post", "cancel:52", "erase:52"]);
});

test("completed blob Markdown is adopted into DownMan and removed from Chrome history", async () => {
  const item = browserDownload({
    id: 51,
    url: "blob:https://github.test/fixture-id",
    finalUrl: "blob:https://github.test/fixture-id",
    filename: "/home/test/Downloads/CHANGELOG.md",
    fileSize: 4150,
    totalBytes: 4150,
  });
  const downloads = [item];
  const worker = browserWorker({}, { downloads });
  worker.listeners.downloadCreated[0](item);
  await new Promise((resolve) => setTimeout(resolve, 20));
  item.state = "complete";
  item.endTime = new Date().toISOString();
  worker.listeners.downloadChanged[0]({ id: 51, state: { current: "complete" } });
  await waitFor(() => worker.posted.some((payload) => payload.kind === "local"), "blob Markdown was not adopted");

  const payload = worker.posted.find((entry) => entry.kind === "local");
  assert.deepEqual(payload.paths, ["/home/test/Downloads/CHANGELOG.md"]);
  assert.equal(worker.erased.length, 1);
  assert.equal(worker.erased[0].id, 51);
  assert.deepEqual(worker.cancelled, []);
});

test("pause failure outside filename hook leaves browser download untouched", async () => {
  const worker = browserWorker({}, { pauseFails: true });
  worker.listeners.downloadCreated[0](browserDownload({ id: 50 }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(worker.posted.length, 0);
  assert.deepEqual(worker.cancelled, []);
});

test("filename, created, and changed events share one capture transaction", async () => {
  const item = browserDownload({ id: 47 });
  const worker = browserWorker({}, { downloads: [item] });
  let suggested = 0;
  worker.listeners.downloadFilename[0](item, () => { suggested += 1; });
  worker.listeners.downloadCreated[0](item);
  worker.listeners.downloadChanged[0]({ id: 47, filename: { current: item.filename } });
  await waitFor(() => suggested === 1, "filename hook did not finish");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(worker.posted.length, 1);
  assert.deepEqual(worker.paused, [47]);
  assert.deepEqual(worker.cancelled, [47]);
});

test("in-progress download survives worker suspension without becoming history replay", async () => {
  const session = {};
  const item = browserDownload({ id: 48 });
  const first = browserWorker(session, {
    downloads: [item],
    rules: { enabled: false, autoExts: ["ZIP"], blockSites: [], blockAddresses: [] },
  });
  first.listeners.downloadCreated[0](item);
  await new Promise((resolve) => setTimeout(resolve, 150));

  const second = browserWorker(session, {
    downloads: [item],
    rules: { enabled: true, autoExts: ["ZIP"], blockSites: [], blockAddresses: [] },
  });
  second.listeners.downloadChanged[0]({ id: 48, filename: { current: item.filename } });
  await waitFor(() => second.posted.length === 1, "restored transaction was not captured");

  assert.deepEqual(second.paused, [48]);
  assert.deepEqual(second.cancelled, [48]);
});

test("a lone page fallback is submitted without showing a chooser", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 9 }, frameId: 0 };
  const pageIntent = {
    ...intent("youtube-player", Date.now()),
    currentSrc: "blob:https://video.test/player",
    frameUrl: "https://video.test/watch?v=abc12345678",
    topUrl: "https://video.test/watch?v=abc12345678",
    pageUrls: [],
    trigger: "button",
  };

  const result = await worker.message({ dm: "media-intent", intent: pageIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted.length, 1);
  assert.equal(worker.posted[0].candidates[worker.posted[0].selectedIndex].kind, "page");
});

test("duplicate Instagram-like page candidates auto-submit one specific extractor URL", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 11 }, frameId: 0 };
  const pageIntent = {
    ...intent("instagram-player", Date.now()),
    frameUrl: "https://social.test/feed",
    topUrl: "https://social.test/feed",
    feedContext: true,
    ownerMediaCount: 1,
    pageUrls: [
      { url: "https://social.test/post/abc12345", strength: 28, bound: true },
      { url: "https://social.test/post/abc12345?source=feed", strength: 24, bound: false },
      { url: "https://social.test/profile/creator", strength: 12 },
    ],
    trigger: "button",
  };

  const result = await worker.message({ dm: "media-intent", intent: pageIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted.length, 1);
  assert.equal(worker.posted[0].candidates[0].url, "https://social.test/post/abc12345/");
  assert.equal(worker.posted[0].selectedIndex, 0);
});

test("a bound status page is submitted despite a feed full of sniffed manifests", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 22 }, frameId: 0 };
  const status = "https://x.test/MeghUpdates/status/2076875071482925434/";
  for (let index = 0; index < 8; index += 1) {
    worker.listeners.headersReceived[0]({
      ...mediaResponse(`https://video.twimg.test/amplify_video/209${index}/pl/avc1/1080x1920/v${index}.m3u8`, 22, 0),
      responseHeaders: [{ name: "content-type", value: "application/x-mpegURL" }],
    });
  }
  const mediaIntent = {
    ...intent("x-feed", Date.now()),
    frameUrl: "https://x.test/home",
    topUrl: "https://x.test/home",
    currentSrc: "blob:https://x.test/e7941f18-0cd2",
    feedContext: true,
    contextKind: "collection",
    ownerMediaCount: 1,
    pageUrls: [{ url: status, identityKey: status, strength: 40, bound: true, binding: "timestamp" }],
    trigger: "button",
  };

  const result = await worker.message({ dm: "media-intent", intent: mediaIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted.length, 1);
  const selected = worker.posted[0].candidates[worker.posted[0].selectedIndex];
  assert.equal(selected.kind, "page");
  assert.equal(selected.url, status);
});

test("X status detail page submits its bound permalink for a blob player", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 20 }, frameId: 0 };
  const status = "https://social.test/user/status/1959123456789";
  const pageIntent = {
    ...intent("x-detail", Date.now()),
    frameUrl: status,
    topUrl: status,
    currentSrc: "blob:https://social.test/69f8d775-66b0-46a4",
    feedContext: true,
    contextKind: "detail",
    ownerMediaCount: 1,
    pageUrls: [{ url: status, identityKey: `${status}/`, strength: 40, bound: true, binding: "document" }],
    trigger: "button",
  };

  const result = await worker.message({ dm: "media-intent", intent: pageIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted.length, 1);
  const selected = worker.posted[0].candidates[worker.posted[0].selectedIndex];
  assert.equal(selected.kind, "page");
  assert.equal(selected.url, `${status}/`);
});

test("Instagram reel detail preserves its bound canonical page during fallback merge", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 17 }, frameId: 0 };
  const reelUrl = "https://social.test/reels/DaoRKe8I0l4/";
  const pageIntent = {
    ...intent("instagram-reel", Date.now()),
    frameUrl: reelUrl,
    topUrl: reelUrl,
    feedContext: true,
    contextKind: "detail",
    ownerMediaCount: 1,
    competingMediaCount: 1,
    pageUrls: [{ url: `${reelUrl}?igsh=tracking`, strength: 40, bound: true }],
    trigger: "button",
  };

  const result = await worker.message({ dm: "media-intent", intent: pageIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted.length, 1);
  const selected = worker.posted[0].candidates[worker.posted[0].selectedIndex];
  assert.equal(selected.url, reelUrl);
  assert.equal(selected.kind, "page");
  assert.equal(selected.pageBound, true);
});

test("Instagram feed collapses equivalent bound permalink variants", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 18 }, frameId: 0 };
  const pageIntent = {
    ...intent("instagram-feed", Date.now()),
    frameUrl: "https://social.test/",
    topUrl: "https://social.test/",
    feedContext: true,
    contextKind: "collection",
    ownerMediaCount: 1,
    competingMediaCount: 1,
    pageUrls: [
      { url: "https://social.test/reels/DaoRKe8I0l4/?igsh=one", strength: 40, bound: true },
      { url: "https://social.test/reels/DaoRKe8I0l4/?source=feed", strength: 32, bound: true },
    ],
    trigger: "button",
  };

  const result = await worker.message({ dm: "media-intent", intent: pageIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted.length, 1);
  assert.equal(worker.posted[0].candidates.filter((candidate) => candidate.pageBound).length, 1);
  assert.equal(worker.posted[0].candidates[worker.posted[0].selectedIndex].url, "https://social.test/reels/DaoRKe8I0l4/");
});

test("X-like manifest ties submit only the bound status page", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 12 }, frameId: 0 };
  const mediaIntent = {
    ...intent("x-player", Date.now()),
    frameUrl: "https://social.test/home",
    topUrl: "https://social.test/home",
    feedContext: true,
    ownerMediaCount: 1,
    pageUrls: [{ url: "https://social.test/user/status/987654321", strength: 30, bound: true }],
    trigger: "button",
  };
  await worker.message({ dm: "media-observed", intent: mediaIntent }, sender);
  worker.listeners.headersReceived[0]({
    ...mediaResponse("https://video.cdn.test/variant-a.m3u8", 12, 0),
    responseHeaders: [{ name: "content-type", value: "application/x-mpegURL" }],
  });
  worker.listeners.headersReceived[0]({
    ...mediaResponse("https://video.cdn.test/variant-b.m3u8", 12, 0),
    responseHeaders: [{ name: "content-type", value: "application/x-mpegURL" }],
  });

  const result = await worker.message({ dm: "media-intent", intent: mediaIntent }, sender);

  assert.equal(result.ok, true);
  const selected = worker.posted[0].candidates[worker.posted[0].selectedIndex];
  assert.equal(selected.url, "https://social.test/user/status/987654321/");
  assert.equal(selected.kind, "page");
  assert.ok(worker.posted[0].candidates.some((candidate) => candidate.kind === "manifest"));
});

test("unbound X-like manifests are refused without a chooser", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 13 }, frameId: 0 };
  const mediaIntent = {
    ...intent("x-unbound", Date.now()),
    frameUrl: "https://social.test/home",
    topUrl: "https://social.test/home",
    feedContext: true,
    ownerMediaCount: 1,
    pageUrls: [],
    trigger: "button",
  };
  for (const name of ["variant-a", "variant-b", "variant-c"]) {
    worker.listeners.headersReceived[0]({
      ...mediaResponse(`https://video.cdn.test/${name}.m3u8`, 13, 0),
      responseHeaders: [{ name: "content-type", value: "application/x-mpegURL" }],
    });
  }

  const result = await worker.message({ dm: "media-intent", intent: mediaIntent }, sender);

  assert.equal(result.code, "ambiguous-player");
  assert.equal(worker.posted.length, 0);
});

test("single-player feed manifest without a bound post is refused", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 15 }, frameId: 0 };
  const mediaIntent = {
    ...intent("single-unbound", Date.now()),
    frameUrl: "https://social.test/home",
    topUrl: "https://social.test/home",
    feedContext: true,
    ownerMediaCount: 1,
    pageUrls: [],
    trigger: "button",
  };
  worker.listeners.headersReceived[0]({
    ...mediaResponse("https://video.cdn.test/avc1/720x1280/single.m3u8", 15, 0),
    responseHeaders: [{ name: "content-type", value: "application/x-mpegURL" }],
  });

  const result = await worker.message({ dm: "media-intent", intent: mediaIntent }, sender);

  assert.equal(result.code, "ambiguous-player");
  assert.equal(worker.posted.length, 0);
});

test("multi-video post submits its uniquely bound permalink", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 16 }, frameId: 0 };
  const mediaIntent = {
    ...intent("multi-post", Date.now()),
    frameUrl: "https://social.test/home",
    topUrl: "https://social.test/home",
    feedContext: true,
    ownerMediaCount: 2,
    pageUrls: [{ url: "https://social.test/user/status/123456789", strength: 40, bound: true }],
    trigger: "button",
  };

  const result = await worker.message({ dm: "media-intent", intent: mediaIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted.length, 1);
  const selected = worker.posted[0].candidates[worker.posted[0].selectedIndex];
  assert.equal(selected.url, "https://social.test/user/status/123456789/");
  assert.equal(selected.kind, "page");
});

test("browser cookies default to the running browser so logged-in content works", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 30 }, frameId: 0 };
  const status = "https://social.test/creator/reel/DaoRKe8I0l4/";
  const mediaIntent = {
    ...intent("ig-detail", Date.now()),
    frameUrl: status,
    topUrl: status,
    contextKind: "detail",
    feedContext: true,
    ownerMediaCount: 1,
    pageUrls: [{ url: status, identityKey: status, strength: 40, bound: true, binding: "document" }],
    trigger: "button",
  };

  const result = await worker.message({ dm: "media-intent", intent: mediaIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted[0].options.cookies, "chrome");
});

test("browser cookies can be explicitly disabled from the options page", async () => {
  const worker = browserWorker({}, { local: { cookies: "none" } });
  const sender = { tab: { id: 31 }, frameId: 0 };
  const status = "https://social.test/creator/reel/DaoRKe8I0l4/";
  const mediaIntent = {
    ...intent("ig-nocookie", Date.now()),
    frameUrl: status,
    topUrl: status,
    contextKind: "detail",
    feedContext: true,
    ownerMediaCount: 1,
    pageUrls: [{ url: status, identityKey: status, strength: 40, bound: true, binding: "document" }],
    trigger: "button",
  };

  const result = await worker.message({ dm: "media-intent", intent: mediaIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted[0].options.cookies, "");
});

test("an exact full currentSrc overrides a ranged observation of the same URL", async () => {
  const worker = browserWorker();
  const sender = { tab: { id: 10 }, frameId: 0 };
  const url = "https://cdn.test/full-video.mp4";
  const directIntent = {
    ...intent("direct-player", Date.now()),
    currentSrc: url,
    sourceKind: "http",
    title: "Direct video",
    trigger: "button",
  };
  const ranged = mediaResponse(url);
  ranged.statusCode = 206;
  ranged.responseHeaders.push({ name: "content-range", value: "bytes 0-999/5000000" });
  worker.listeners.headersReceived[0](ranged);

  const result = await worker.message({ dm: "media-intent", intent: directIntent }, sender);

  assert.equal(result.ok, true);
  assert.equal(worker.posted[0].candidates[0].url, url);
  assert.equal(worker.posted[0].candidates[0].partial, false);
  assert.equal(worker.posted[0].options.title, "Direct video");
});
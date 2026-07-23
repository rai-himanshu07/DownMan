import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const probeSource = await readFile(new URL("../extensions/mse-probe.js", import.meta.url), "utf8");

function probeHarness() {
  const messageListeners = [];
  const signals = [];
  let clock = 100;
  let objectSequence = 0;

  class FakeSourceBuffer {
    appendBuffer(data) {
      this.lastLength = data.byteLength;
    }
  }
  class FakeMediaSource {
    addSourceBuffer() {
      return new FakeSourceBuffer();
    }
  }
  class FakeXhr {
    open(_method, url) { this.responseURL = String(url); }
    addEventListener() {}
    getResponseHeader() { return ""; }
    send() {}
  }

  const window = {
    addEventListener(type, listener) {
      if (type === "message") messageListeners.push(listener);
    },
    postMessage(data) {
      signals.push(structuredClone(data));
      for (const listener of messageListeners) listener({ source: window, data });
    },
  };
  const UrlApi = {
    createObjectURL() {
      objectSequence += 1;
      return `blob:https://page.test/${objectSequence}`;
    },
  };
  const originalFetch = async (input) => {
    const url = String(input);
    const contentType = url.endsWith(".json") ? "application/json" : "application/vnd.apple.mpegurl";
    return { url, headers: { get: () => contentType } };
  };
  Object.assign(window, {
    URL: UrlApi,
    MediaSource: FakeMediaSource,
    XMLHttpRequest: FakeXhr,
    fetch: originalFetch,
  });

  const context = vm.createContext({
    Date,
    Map,
    MediaSource: FakeMediaSource,
    URL: UrlApi,
    WeakMap,
    XMLHttpRequest: FakeXhr,
    fetch: originalFetch,
    performance: { now: () => clock },
    structuredClone,
    window,
  });
  vm.runInContext(probeSource, context, { filename: "mse-probe.js" });
  return {
    context,
    signals,
    setClock(value) { clock = value; },
  };
}

test("MSE probe replays early object ownership and ignores non-media traffic", async () => {
  const harness = probeHarness();
  const { context, signals } = harness;
  const source = new context.MediaSource();
  const objectUrl = context.URL.createObjectURL(source);
  await context.window.fetch("https://cdn.test/master.m3u8");
  source.addSourceBuffer("video/mp4; codecs=avc1").appendBuffer(new Uint8Array([1, 2, 3, 4]));

  assert.ok(signals.some((signal) => signal.kind === "object-url" && signal.objectUrl === objectUrl));
  assert.ok(signals.some((signal) => signal.kind === "owned-url" && signal.url === "https://cdn.test/master.m3u8"));
  assert.ok(signals.every((signal) => !("data" in signal) && !("body" in signal)));

  signals.length = 0;
  context.window.postMessage({ __downmanMseControlV1: true, kind: "ready" }, "*");
  assert.ok(signals.some((signal) => signal.kind === "object-url" && signal.objectUrl === objectUrl));
  assert.ok(signals.some((signal) => signal.kind === "owned-url" && signal.url === "https://cdn.test/master.m3u8"));

  signals.length = 0;
  harness.setClock(5_000);
  await context.window.fetch("https://cdn.test/config.json");
  source.addSourceBuffer("video/mp4").appendBuffer(new Uint8Array([9]));
  assert.ok(!signals.some((signal) => signal.kind === "owned-url"));
});

import assert from "node:assert/strict";
import test from "node:test";

await import("../extensions/media-resolver.js");
const resolver = globalThis.DownManMediaResolver;

const NOW = 2_000_000;
const baseIntent = {
  frameId: 3,
  mediaId: "media-2",
  element: "video",
  currentSrc: "blob:https://example.test/player",
  sourceKind: "blob",
  playing: true,
  viewportArea: 240000,
  triggeredAt: NOW,
};

function candidate(overrides = {}) {
  return {
    url: "https://cdn.example.test/media",
    kind: "file",
    contentType: "video/mp4",
    size: 12 * 1024 * 1024,
    frameId: 3,
    lastSeen: NOW - 1000,
    ...overrides,
  };
}

test("same-frame manifest outranks newer unrelated media", () => {
  const ranked = resolver.rankCandidates([
    candidate({ url: "https://ads.test/new.mp4", frameId: 0, lastSeen: NOW - 10 }),
    candidate({ url: "https://cdn.example.test/master", kind: "manifest", contentType: "application/vnd.apple.mpegurl" }),
  ], baseIntent, NOW);

  assert.equal(ranked[0].kind, "manifest");
  assert.match(ranked[0].url, /master$/);
  assert.ok(ranked[0].reasons.includes("same-frame"));
});

test("a correlated player session beats a newer same-frame video", () => {
  const ranked = resolver.rankCandidates([
    candidate({ url: "https://cdn.example.test/newer-video", mediaIds: ["media-1"], lastSeen: NOW - 10 }),
    candidate({ url: "https://cdn.example.test/clicked-video", mediaIds: ["media-2"], lastSeen: NOW - 8000 }),
  ], baseIntent, NOW);

  assert.match(ranked[0].url, /clicked-video$/);
  assert.ok(ranked[0].reasons.includes("same-media-session"));
});

test("exact HTTP currentSrc is the strongest direct evidence", () => {
  const url = "https://cdn.example.test/movie?id=42";
  const ranked = resolver.rankCandidates([
    candidate({ url: "https://cdn.example.test/master.m3u8", kind: "manifest" }),
    candidate({ url, contentType: "video/mp4" }),
  ], { ...baseIntent, currentSrc: url }, NOW);

  assert.equal(ranked[0].url, url);
  assert.ok(ranked[0].reasons.includes("exact-current-src"));
});

test("video intent penalizes audio-only and segment responses", () => {
  const ranked = resolver.rankCandidates([
    candidate({ url: "https://cdn.example.test/audio", contentType: "audio/mp4" }),
    candidate({ url: "https://cdn.example.test/segment-104.m4s", size: 900000 }),
    candidate({ url: "https://cdn.example.test/video", contentType: "video/mp4" }),
  ], baseIntent, NOW);

  assert.match(ranked[0].url, /video$/);
  const segment = resolver.scoreCandidate(
    candidate({ url: "https://cdn.example.test/segment-104.m4s", size: 900000 }),
    { ...baseIntent, sourceKind: "http" },
    NOW,
  );
  assert.ok(segment.reasons.includes("segment"));
});

test("blob players exclude partial range responses", () => {
  const ranked = resolver.rankCandidates([
    candidate({ url: "https://cdn.example.test/video?bytestart=1&byteend=999", partial: true }),
  ], baseIntent, NOW);

  assert.equal(ranked.length, 0);
});

test("a correlated manifest beats its media fragments without a chooser", () => {
  const ranked = resolver.rankCandidates([
    candidate({
      url: "https://cdn.example.test/master.m3u8",
      kind: "manifest",
      contentType: "application/vnd.apple.mpegurl",
      mediaIds: ["media-2"],
    }),
    candidate({
      url: "https://cdn.example.test/fragment-12.m4s",
      mediaIds: ["media-2"],
      lastSeen: NOW - 10,
    }),
  ], baseIntent, NOW);

  assert.equal(ranked[0].kind, "manifest");
  assert.equal(resolver.confidenceFor(ranked), "high");
});

test("video intents reject audio-only manifests and prefer video variants", () => {
  const ranked = resolver.rankCandidates([
    candidate({
      url: "https://cdn.example.test/pl/mp4a/128000/audio.m3u8",
      kind: "manifest",
      contentType: "application/vnd.apple.mpegurl",
      mediaIds: ["media-2"],
    }),
    candidate({
      url: "https://cdn.example.test/pl/avc1/320x480/video.m3u8",
      kind: "manifest",
      contentType: "application/vnd.apple.mpegurl",
      mediaIds: ["media-2"],
    }),
  ], baseIntent, NOW);

  assert.equal(ranked.length, 1);
  assert.match(ranked[0].url, /avc1\/320x480/);
  assert.ok(ranked[0].reasons.includes("video-manifest"));
});

test("expired volatile candidates are removed", () => {
  const ranked = resolver.rankCandidates([
    candidate({ url: "https://cdn.example.test/old.m3u8", kind: "manifest", lastSeen: NOW - resolver.MANIFEST_TTL_MS - 1 }),
    candidate({ url: "https://cdn.example.test/fresh.m3u8", kind: "manifest" }),
  ], baseIntent, NOW);

  assert.deepEqual(ranked.map((item) => item.url), ["https://cdn.example.test/fresh.m3u8"]);
});

test("near-tied candidates produce low confidence", () => {
  const ranked = resolver.rankCandidates([
    candidate({ url: "https://one.test/video" }),
    candidate({ url: "https://two.test/video", lastSeen: NOW - 1200 }),
  ], baseIntent, NOW);

  assert.equal(resolver.confidenceFor(ranked), "low");
});

test("weak evidence produces no automatic candidate", () => {
  const ranked = resolver.rankCandidates([
    candidate({
      url: "https://cdn.example.test/click.mp3",
      contentType: "audio/mpeg",
      size: 12000,
      frameId: 9,
      lastSeen: NOW - 90000,
    }),
  ], baseIntent, NOW);

  assert.equal(resolver.confidenceFor(ranked), "none");
});

test("a page URL alone requires an explicit user choice", () => {
  const ranked = resolver.rankCandidates([
    candidate({
      url: "https://example.test/feed",
      kind: "page",
      contentType: "text/html",
      size: 0,
    }),
  ], baseIntent, NOW);

  assert.equal(resolver.confidenceFor(ranked), "low");
  assert.ok(ranked[0].reasons.includes("page-fallback"));
});

test("content page identity is canonical across X and Instagram URL variants", () => {
  const cases = [
    ["https://x.test/owner/status/123456789/photo/1?ref=feed", "https://x.test/owner/status/123456789/"],
    ["https://social.test/reels/DaoRKe8I0l4/?igsh=tracking", "https://social.test/reels/DaoRKe8I0l4/"],
    ["https://social.test/p/DZAVwXsk0Tr/?img_index=2", "https://social.test/p/DZAVwXsk0Tr/"],
    ["https://social.test/stories/creator/3936118127759042586/?source=feed", "https://social.test/stories/creator/3936118127759042586/"],
    ["https://video.test/watch?v=abc12345678&list=related", "https://video.test/watch?v=abc12345678"],
  ];

  for (const [input, expected] of cases) {
    const identity = resolver.pageIdentity(input);
    assert.equal(identity.specific, true, input);
    assert.equal(identity.url, expected, input);
    assert.equal(identity.key, expected, input);
  }
  assert.equal(resolver.pageIdentity("https://social.test/").specific, false);
  assert.equal(resolver.pageIdentity("https://social.test/creator_name/").specific, false);
  assert.equal(resolver.pageIdentity("https://social.test/reels/").specific, false);
});

test("a bound permalink is the media identity on feeds and detail pages alike", () => {
  const boundPage = candidate({
    url: "https://social.test/reels/DaoRKe8I0l4/",
    kind: "page",
    contentType: "text/html",
    pageBound: true,
    pageIdentity: "https://social.test/reels/DaoRKe8I0l4/",
    pageStrength: 40,
  });
  const correlatedManifest = candidate({
    url: "https://cdn.test/avc1/720x1280/master.m3u8",
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    mediaIds: ["media-2"],
  });

  assert.deepEqual(
    resolver.planResolution([boundPage, correlatedManifest], { ...baseIntent, contextKind: "collection" }, "high"),
    { action: "submit", index: 0, reason: "bound-page" },
  );
  assert.deepEqual(
    resolver.planResolution([boundPage], { ...baseIntent, contextKind: "detail" }, "low"),
    { action: "submit", index: 0, reason: "bound-page" },
  );
});

test("a structurally bound page survives a crowd of higher-scoring feed manifests", () => {
  const manifests = Array.from({ length: 8 }, (_, index) => candidate({
    url: `https://video.cdn.test/amplify/${index}/avc1/1080x1920/master.m3u8`,
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    frameId: 3,
    lastSeen: NOW - 100,
  }));
  const boundPage = candidate({
    url: "https://x.test/user/status/123456789/",
    kind: "page",
    contentType: "text/html",
    pageBound: true,
    pageStrength: 40,
    pageIdentity: "https://x.test/user/status/123456789/",
    size: 0,
  });

  const ranked = resolver.rankCandidates([...manifests, boundPage], baseIntent, NOW);
  const page = ranked.find((entry) => entry.kind === "page" && entry.pageBound);
  assert.ok(page, "the bound page must survive ranking");
  assert.deepEqual(
    resolver.planResolution(ranked, { ...baseIntent, contextKind: "collection" }, resolver.confidenceFor(ranked)),
    { action: "submit", index: ranked.indexOf(page), reason: "bound-page" },
  );
});

test("a multi-video tweet downloads the clicked video through its own media-key manifest", () => {
  const clicked = candidate({
    url: "https://video.twimg.test/amplify_video/999888777/pl/avc1/720x1280/a.m3u8",
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    frameId: 3,
  });
  const other = candidate({
    url: "https://video.twimg.test/amplify_video/111222333/pl/avc1/1080x1920/b.m3u8",
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    frameId: 3,
  });
  const boundPage = candidate({
    url: "https://x.test/user/status/555/",
    kind: "page",
    contentType: "text/html",
    pageBound: true,
    pageStrength: 40,
    pageIdentity: "https://x.test/user/status/555/",
    size: 0,
  });
  const intent = { ...baseIntent, contextKind: "detail", ownerMediaCount: 2, mediaKeys: ["999888777"] };

  const ranked = resolver.rankCandidates([boundPage, clicked, other], intent, NOW);
  const plan = resolver.planResolution(ranked, intent, resolver.confidenceFor(ranked));
  assert.equal(plan.action, "submit");
  assert.equal(plan.reason, "media-key-manifest");
  assert.match(ranked[plan.index].url, /amplify_video\/999888777\//);
});

test("media-key matching prefers a master playlist over a fixed-resolution variant", () => {
  const variant = candidate({ url: "https://video.twimg.test/amplify_video/999/pl/avc1/720x1280/a.m3u8", kind: "manifest", contentType: "application/vnd.apple.mpegurl" });
  const master = candidate({ url: "https://video.twimg.test/amplify_video/999/pl/hash.m3u8?tag=28", kind: "manifest", contentType: "application/vnd.apple.mpegurl" });
  const intent = { ...baseIntent, contextKind: "detail", ownerMediaCount: 2, mediaKeys: ["999"] };

  const plan = resolver.planResolution([variant, master], intent, "low");
  assert.equal(plan.reason, "media-key-manifest");
  assert.match([variant, master][plan.index].url, /pl\/hash\.m3u8/);
});

test("a single-video post ignores media keys and prefers its page extractor", () => {
  const manifest = candidate({ url: "https://video.twimg.test/amplify_video/777/pl/avc1/720x1280/a.m3u8", kind: "manifest", contentType: "application/vnd.apple.mpegurl" });
  const boundPage = candidate({
    url: "https://x.test/user/status/888/",
    kind: "page",
    contentType: "text/html",
    pageBound: true,
    pageStrength: 40,
    pageIdentity: "https://x.test/user/status/888/",
    size: 0,
  });
  const intent = { ...baseIntent, contextKind: "detail", ownerMediaCount: 1, mediaKeys: ["777"] };

  const plan = resolver.planResolution([manifest, boundPage], intent, "low");
  assert.equal(plan.reason, "bound-page");
  assert.equal([manifest, boundPage][plan.index].kind, "page");
});

test("a feed quote-tweet prefers the clicked video's own media-key manifest over a bound page", () => {
  // The outer tweet quotes another tweet whose video is still a thumbnail (not a
  // materialised <video>), so ownerMediaCount is 1 and nested is false. The bound
  // status page would let yt-dlp resolve the quoted video, so in a feed the clicked
  // player's own keyed manifest (its master playlist) must win.
  const clickedVariant = candidate({
    url: "https://video.twimg.test/amplify_video/2078043949848219648/pl/avc1/1920x1080/v.m3u8",
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    frameId: 3,
  });
  const clickedMaster = candidate({
    url: "https://video.twimg.test/amplify_video/2078043949848219648/pl/master.m3u8?tag=29",
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    frameId: 3,
  });
  const quotedManifest = candidate({
    url: "https://video.twimg.test/ext_tw_video/2078030350962270208/pu/pl/avc1/1276x718/q.m3u8",
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    frameId: 3,
  });
  const boundPage = candidate({
    url: "https://x.test/BeingPolitical1/status/2078044024414290038/",
    kind: "page",
    contentType: "text/html",
    pageBound: true,
    pageStrength: 40,
    pageIdentity: "https://x.test/BeingPolitical1/status/2078044024414290038/",
    size: 0,
  });
  const intent = {
    ...baseIntent,
    contextKind: "collection",
    ownerMediaCount: 1,
    nested: false,
    mediaKeys: ["2078043949848219648"],
  };

  const ranked = resolver.rankCandidates([boundPage, quotedManifest, clickedVariant, clickedMaster], intent, NOW);
  const plan = resolver.planResolution(ranked, intent, resolver.confidenceFor(ranked));
  assert.equal(plan.action, "submit");
  assert.equal(plan.reason, "media-key-manifest");
  assert.match(ranked[plan.index].url, /amplify_video\/2078043949848219648\/pl\/master\.m3u8/);
});

test("a media-key manifest survives a crowd of higher-scoring feed manifests", () => {
  const manifests = Array.from({ length: 8 }, (_, index) => candidate({
    url: `https://video.twimg.test/amplify_video/other${index}/pl/avc1/1080x1920/m${index}.m3u8`,
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    frameId: 3,
    lastSeen: NOW - 50,
  }));
  const clicked = candidate({
    url: "https://video.twimg.test/amplify_video/CLICKED123/pl/avc1/480x854/c.m3u8",
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    frameId: 3,
    lastSeen: NOW - 5000,
  });

  const ranked = resolver.rankCandidates([...manifests, clicked], { ...baseIntent, ownerMediaCount: 2, mediaKeys: ["CLICKED123"] }, NOW);
  assert.ok(ranked.some((entry) => /CLICKED123/.test(entry.url)), "the keyed manifest must survive ranking");
});

test("a quoted/reply video with its own bound permalink submits that permalink", () => {
  const quotedPage = candidate({
    url: "https://x.test/quoted/status/222222222/",
    kind: "page",
    contentType: "text/html",
    pageBound: true,
    pageStrength: 40,
    pageIdentity: "https://x.test/quoted/status/222222222/",
    size: 0,
  });

  assert.deepEqual(
    resolver.planResolution([quotedPage], { ...baseIntent, contextKind: "detail", nested: true }, "low"),
    { action: "submit", index: 0, reason: "bound-page" },
  );
});

test("a nested quoted video without its own permalink is refused, never the outer post", () => {
  const outerManifest = candidate({
    url: "https://video.twimg.test/amplify/999/avc1/1080x1920/master.m3u8",
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    mediaIds: ["outer-media"],
  });

  assert.deepEqual(
    resolver.planResolution([outerManifest], { ...baseIntent, contextKind: "detail", nested: true }, "low"),
    { action: "refuse", code: "ambiguous-player", reason: "unbound-collection" },
  );
});

test("a feed stream is used only when it is correlated to the clicked player", () => {
  const correlated = candidate({
    url: "https://cdn.test/avc1/720x1280/master.m3u8",
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    mediaIds: ["media-2"],
  });
  const foreign = candidate({
    url: "https://cdn.test/avc1/720x1280/other.m3u8",
    kind: "manifest",
    contentType: "application/vnd.apple.mpegurl",
    mediaIds: ["media-9"],
  });

  assert.deepEqual(
    resolver.planResolution([correlated], { ...baseIntent, contextKind: "collection" }, "high"),
    { action: "submit", index: 0, reason: "player-correlated-manifest" },
  );
  assert.deepEqual(
    resolver.planResolution([foreign], { ...baseIntent, contextKind: "collection" }, "high"),
    { action: "refuse", code: "ambiguous-player", reason: "unbound-collection" },
  );
});
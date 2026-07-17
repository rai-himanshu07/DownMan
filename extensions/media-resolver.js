(function (root, factory) {
  const api = factory();
  root.DownManMediaResolver = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = 2;
  const MANIFEST_TTL_MS = 2 * 60 * 1000;
  const FILE_TTL_MS = 10 * 60 * 1000;
  const MAX_RANKED_CANDIDATES = 8;

  const MANIFEST_CONTENT_RE = /(?:mpegurl|dash\+xml)/i;
  const VIDEO_CONTENT_RE = /^video\//i;
  const AUDIO_CONTENT_RE = /^audio\//i;
  const SEGMENT_RE = /(?:^|[/.?&=_-])(?:seg(?:ment)?|chunk|frag(?:ment)?|part|init)[-_]?\d+(?:[.?&#_-]|$)|\.(?:m4s|cmfv|cmfa)(?:[?#]|$)/i;
  const JUNK_NAME_RE = /\/(?:failure|success|open|close|no_input|notification|click|ding|dong|pop|beep|silence|blank|error|alert|chime|tone|tick|swoosh|whoosh)\.(?:mp3|m4a|wav|ogg|aac|opus)(?:\?|$)/i;
  const JUNK_URL_RE = /(?:^|[./_-])(?:ads?|tracking|analytics|pixel)(?:[./?&=_-]|$)/i;
  const CONTENT_ROUTE_MARKERS = new Set([
    "article", "articles", "clip", "clips", "p", "post", "posts", "reel", "reels",
    "short", "shorts", "status", "statuses", "video", "videos",
  ]);
  const QUERY_ID_KEYS = ["v", "video_id", "story_fbid", "fbid", "post_id", "clip_id"];

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  // A manifest URL like .../<id>/pl/avc1/720x1280/x.m3u8 carries the
  // media resolution; rank a master playlist (no explicit WxH) highest so quality
  // selection stays automatic, otherwise prefer the largest variant.
  function manifestResolutionRank(url) {
    const match = String(url || "").match(/(\d{2,4})x(\d{2,4})/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    return Number(match[1]) * Number(match[2]);
  }

  function matchesMediaKey(url, keys) {
    if (!keys || !keys.length) return false;
    const value = String(url || "");
    return keys.some((key) => key && value.includes(key));
  }

  function identityToken(value) {
    return typeof value === "string" && value.length >= 5 && /^[A-Za-z0-9._~-]+$/.test(value);
  }

  function pageIdentity(rawUrl, baseUrl) {
    try {
      const url = new URL(rawUrl, baseUrl);
      url.hash = "";
      const segments = url.pathname.split("/").filter(Boolean);
      let identityEnd = -1;

      for (let index = 0; index < segments.length - 1; index += 1) {
        const marker = segments[index].toLowerCase();
        if (CONTENT_ROUTE_MARKERS.has(marker) && identityToken(segments[index + 1])) {
          identityEnd = index + 1;
          break;
        }
        if (marker === "stories" && identityToken(segments[index + 2])) {
          identityEnd = index + 2;
          break;
        }
      }

      if (identityEnd >= 0) {
        url.pathname = `/${segments.slice(0, identityEnd + 1).join("/")}/`;
        url.search = "";
        return { url: url.href, key: url.href, specific: true };
      }

      for (const key of QUERY_ID_KEYS) {
        const value = url.searchParams.get(key);
        if (!identityToken(value)) continue;
        url.search = "";
        url.searchParams.set(key, value);
        return { url: url.href, key: url.href, specific: true };
      }

      return { url: url.href, key: url.href, specific: false };
    } catch (_) {
      return { url: String(rawUrl || ""), key: String(rawUrl || ""), specific: false };
    }
  }

  function candidateKind(candidate) {
    if (candidate.kind === "manifest" || candidate.type === "stream" || MANIFEST_CONTENT_RE.test(candidate.contentType || "")) {
      return "manifest";
    }
    if (candidate.kind === "page") return "page";
    return "file";
  }

  function scoreCandidate(candidate, intent, now) {
    const reasons = [];
    const kind = candidateKind(candidate);
    const seen = finite(candidate.lastSeen, finite(candidate.seen, 0));
    const age = Math.max(0, now - seen);
    const ttl = kind === "file" ? FILE_TTL_MS : MANIFEST_TTL_MS;
    let score = 0;

    if (!candidate.url || age > ttl) {
      return { ...candidate, kind, score: -1000, reasons: [!candidate.url ? "missing-url" : "expired"] };
    }

    if (intent.sourceKind === "blob" && (candidate.partial || SEGMENT_RE.test(candidate.url))) {
      return { ...candidate, kind, score: -1000, reasons: ["media-fragment"] };
    }

    const sameFrame = candidate.frameId === intent.frameId;
    if (sameFrame) {
      score += 34;
      reasons.push("same-frame");
    } else if (candidate.frameId != null && intent.frameId != null) {
      score -= 18;
      reasons.push("other-frame");
    }

    const mediaIds = Array.isArray(candidate.mediaIds) ? candidate.mediaIds : [];
    if (intent.mediaId && mediaIds.includes(intent.mediaId)) {
      score += 55;
      reasons.push("same-media-session");
    } else if (intent.mediaId && mediaIds.length) {
      score -= 20;
      reasons.push("other-media-session");
    }

    const currentSrc = intent.currentSrc || "";
    if (/^https?:/i.test(currentSrc) && candidate.url === currentSrc) {
      score += 70;
      reasons.push("exact-current-src");
    }

    if (kind === "manifest") {
      score += 55;
      reasons.push("manifest");
      const audioManifest = /(?:^|[\/_-])(?:mp4a|audio|aac|opus)(?:[\/_-]|$)/i.test(candidate.url);
      const videoManifest = /(?:^|[\/_-])(?:avc1|av01|h26[45]|hevc|vp0?9)(?:[\/_-]|$)|\d{2,4}x\d{2,4}/i.test(candidate.url);
      if (intent.element === "video" && audioManifest) {
        return { ...candidate, kind, score: -1000, reasons: [...reasons, "audio-manifest-for-video"] };
      } else if (intent.element === "video" && videoManifest) {
        score += 18;
        reasons.push("video-manifest");
      }
    } else if (kind === "page") {
      score -= 30;
      reasons.push("page-fallback");
      const strength = Math.min(30, Math.max(0, finite(candidate.pageStrength, 0)));
      if (strength) {
        score += strength;
        reasons.push("specific-page");
      }
      if (candidate.pageBound) {
        score += 18;
        reasons.push("bound-page");
      }
    } else if (VIDEO_CONTENT_RE.test(candidate.contentType || "")) {
      score += intent.element === "audio" ? -28 : 32;
      reasons.push(intent.element === "audio" ? "video-for-audio" : "video-content");
    } else if (AUDIO_CONTENT_RE.test(candidate.contentType || "")) {
      score += intent.element === "audio" ? 28 : -24;
      reasons.push(intent.element === "audio" ? "audio-content" : "audio-only-for-video");
    } else if (kind === "file") {
      score += 12;
      reasons.push("media-file");
    }

    if (intent.playing) {
      score += 10;
      reasons.push("playing");
    }
    if (finite(intent.viewportArea, 0) >= 120000) {
      score += 6;
      reasons.push("large-visible-player");
    }

    const actionAt = finite(intent.triggeredAt, now);
    const delta = Math.abs(seen - actionAt);
    if (delta <= 5000) {
      score += 24;
      reasons.push("seen-near-action");
    } else if (delta <= 30000) {
      score += 12;
      reasons.push("seen-recently");
    } else if (delta > 120000) {
      score -= 15;
      reasons.push("stale");
    }

    const size = finite(candidate.size, 0);
    if (size >= 8 * 1024 * 1024) {
      score += 10;
      reasons.push("large-response");
    } else if (size > 0 && size < 256 * 1024) {
      score -= 18;
      reasons.push("tiny-response");
    }

    if (SEGMENT_RE.test(candidate.url)) {
      score -= 45;
      reasons.push("segment");
    }
    if (candidate.partial) {
      score -= 80;
      reasons.push("partial-response");
    }
    if (JUNK_NAME_RE.test(candidate.url) || JUNK_URL_RE.test(candidate.url)) {
      score -= 80;
      reasons.push("likely-ui-or-ad");
    }

    return { ...candidate, kind, score, reasons };
  }

  function rankCandidates(candidates, intent, now = Date.now()) {
    const keys = intent && Array.isArray(intent.mediaKeys) ? intent.mediaKeys : [];
    const scored = (candidates || [])
      .map((candidate) => scoreCandidate(candidate, intent || {}, now))
      .filter((candidate) => candidate.score > -1000)
      .sort((left, right) => right.score - left.score || (right.lastSeen || right.seen || 0) - (left.lastSeen || left.seen || 0));
    const kept = scored.slice(0, MAX_RANKED_CANDIDATES);
    // A structurally bound permalink is DOM identity evidence, not sniffed network
    // noise, and a manifest carrying the clicked video's own media key is its exact
    // source. A busy feed can surface many unrelated players' manifests that all
    // outscore either signal; never let them truncate the clicked post's page link
    // or the clicked video's own manifest out of the bundle.
    for (const candidate of scored) {
      const isBoundPage = candidate.kind === "page" && candidate.pageBound;
      const isKeyedManifest = candidate.kind === "manifest" && matchesMediaKey(candidate.url, keys);
      if ((isBoundPage || isKeyedManifest) && !kept.includes(candidate)) {
        kept.push(candidate);
      }
    }
    return kept;
  }

  function confidenceFor(ranked) {
    if (!ranked.length || ranked[0].score < 35) return "none";
    if (ranked[0].score < 65) return "low";
    if (ranked[1] && ranked[0].score - ranked[1].score < 12) return "low";
    return "high";
  }

  function planResolution(ranked, intent, confidence) {
    const candidates = Array.isArray(ranked) ? ranked : [];
    const mediaIntent = intent || {};
    const currentSrc = mediaIntent.currentSrc || "";

    // 1. The exact progressive file the clicked player is already using.
    const exactIndex = /^https?:/i.test(currentSrc)
      ? candidates.findIndex((candidate) => candidate.url === currentSrc)
      : -1;
    if (exactIndex >= 0) return { action: "submit", index: exactIndex, reason: "exact-current-src" };

    // 1b. The exact clicked player identified by its media key (e.g. a poster /
    //    manifest media ID). When one post holds several videos the page
    //    URL is ambiguous, so a manifest whose URL carries the clicked video's own
    //    media ID is the precise target. Only trust this when there is genuine
    //    ambiguity (more than one player in the unit, or a nested quote) so single
    //    videos still prefer the page extractor for best quality and auth.
    //    A feed is inherently ambiguous too: a bound status link can be a quote-tweet
    //    or neighbouring post whose page extractor resolves a DIFFERENT video, and a
    //    quoted player may still be a thumbnail (not a materialised <video>), so
    //    ownerMediaCount misses it. On a detail page the opened document is
    //    unambiguous, so only a collection/feed context is treated as ambiguous here.
    const contextKind = mediaIntent.contextKind || (mediaIntent.feedContext ? "collection" : "document");
    const keys = Array.isArray(mediaIntent.mediaKeys) ? mediaIntent.mediaKeys : [];
    const ambiguous = finite(mediaIntent.ownerMediaCount, 1) > 1 || !!mediaIntent.nested || contextKind === "collection";
    if (ambiguous && keys.length) {
      const keyed = candidates
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => candidateKind(candidate) === "manifest"
          && !candidate.partial
          && matchesMediaKey(candidate.url, keys));
      if (keyed.length) {
        keyed.sort((left, right) => manifestResolutionRank(right.candidate.url) - manifestResolutionRank(left.candidate.url));
        return { action: "submit", index: keyed[0].index, reason: "media-key-manifest" };
      }
    }

    // 2. A permalink bound to the clicked player's own container, or the current
    //    detail document. nearbyPageUrls binds the nearest specific link to THIS
    //    player, so the strongest bound page is this media's own post on any site.
    //    Distinct identities have already been collapsed in the ledger by key.
    let boundIndex = -1;
    let boundStrength = -Infinity;
    candidates.forEach((candidate, index) => {
      if (candidateKind(candidate) !== "page" || !candidate.pageBound) return;
      const strength = finite(candidate.pageStrength, 0);
      if (strength > boundStrength) {
        boundStrength = strength;
        boundIndex = index;
      }
    });
    if (boundIndex >= 0) return { action: "submit", index: boundIndex, reason: "bound-page" };

    // 3. In a feed, or inside a nested quoted/embedded post, with no exact source and
    //    no bound permalink of its own, only a stream that was explicitly correlated
    //    to THIS player (its mediaId) may be used, so a neighbouring or outer post's
    //    stream can never be downloaded.
    if (contextKind === "collection" || mediaIntent.nested) {
      const correlated = candidates.findIndex((candidate) => (
        candidateKind(candidate) === "manifest"
        && !candidate.partial
        && (candidate.mediaIds || []).includes(mediaIntent.mediaId)
      ));
      if (correlated >= 0) return { action: "submit", index: correlated, reason: "player-correlated-manifest" };
      return { action: "refuse", code: "ambiguous-player", reason: "unbound-collection" };
    }

    // 4. Ordinary pages: fall back to confidence scoring and, if needed, a chooser.
    if (confidence === "none" || !candidates.length) {
      return { action: "refuse", code: "no-candidate", reason: "no-candidate" };
    }
    if (confidence !== "low") return { action: "submit", index: 0, reason: "high-confidence" };

    const viable = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.score >= 20 && !candidate.partial);
    if (mediaIntent.mediaSessionCount > 1) {
      const correlated = viable.find(({ candidate }) => (
        candidateKind(candidate) === "manifest" && (candidate.mediaIds || []).includes(mediaIntent.mediaId)
      ));
      const exactSource = viable.find(({ candidate }) => /^https?:/i.test(currentSrc) && candidate.url === currentSrc);
      if (!correlated && !exactSource) {
        return { action: "refuse", code: "ambiguous-player", reason: "concurrent-media" };
      }
    }

    let pageAdded = false;
    let manifestAdded = false;
    const indexes = viable
      .filter(({ candidate }) => {
        const kind = candidateKind(candidate);
        if (kind === "manifest") {
          if (manifestAdded) return false;
          manifestAdded = true;
        }
        if (kind !== "page") return true;
        if (pageAdded) return false;
        pageAdded = true;
        return true;
      })
      .map(({ index }) => index)
      .slice(0, 3);
    if (indexes.length === 1 && candidateKind(candidates[indexes[0]]) === "page") {
      return { action: "submit", index: indexes[0], reason: "single-page" };
    }
    if (!indexes.length) return { action: "refuse", code: "no-candidate", reason: "no-candidate" };
    return { action: "choose", indexes, reason: "low-confidence" };
  }

  return {
    SCHEMA_VERSION,
    MANIFEST_TTL_MS,
    FILE_TTL_MS,
    MAX_RANKED_CANDIDATES,
    candidateKind,
    pageIdentity,
    planResolution,
    scoreCandidate,
    rankCandidates,
    confidenceFor,
  };
});
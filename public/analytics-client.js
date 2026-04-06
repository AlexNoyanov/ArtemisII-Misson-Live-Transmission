/**
 * Sends one anonymous page-load record to your analytics API.
 * IP is recorded only on the server from the HTTP request (never from this script).
 *
 * Override URL: ?analytics_endpoint=https://example.com/api/visit.php
 * Optional auth: set window.__ARTEMIS_ANALYTICS_TOKEN__ before the module runs (do not commit secrets).
 *
 * Also sends a stable pseudonymous userId (localStorage) for analytics_user_devices upsert on the server.
 */

const FALLBACK_ANALYTICS_URL = "https://noyanov.com/Apps/data/api/visit.php";

/** CSS pixel bucket "min×max" → likely iPhone / iPod class (many models share the same logical resolution). */
const IPHONE_IPOD_BY_CSS = new Map([
  ["320x568", "iPhone SE (1st gen) / iPhone 5s class"],
  ["375x667", "iPhone 6/7/8 / SE (2nd–3rd gen) class"],
  ["375x812", "iPhone X/XS/11 Pro / 12 mini / 13 mini class"],
  ["390x844", "iPhone 12/13/14/15 (standard) class"],
  ["393x852", "iPhone 14 Pro / 15 Pro / 16 class"],
  ["402x874", "iPhone 15 Pro Max / 16 Pro class"],
  ["414x736", "iPhone 6/7/8 Plus class"],
  ["414x896", "iPhone XS Max / 11 Pro Max class"],
  ["428x926", "iPhone 12 Pro Max / 13 Pro Max class"],
  ["430x932", "iPhone 14 Plus / 15 Plus / 16 Plus class"],
  ["440x956", "iPhone 16 Pro Max class (guess)"],
]);

const IPAD_BY_CSS = new Map([
  ["768x1024", "iPad 9.7\" / older iPad class"],
  ["810x1080", "iPad 10th gen class"],
  ["744x1133", "iPad mini class"],
  ["820x1180", "iPad Air class"],
  ["834x1112", "iPad Pro 11\" class"],
  ["834x1194", "iPad Pro 11\" (newer) class"],
  ["1024x1366", "iPad Pro 12.9\" class"],
]);

function analyticsEndpoint() {
  if (typeof window !== "undefined" && window.__ARTEMIS_ANALYTICS_URL__) {
    return window.__ARTEMIS_ANALYTICS_URL__;
  }
  try {
    const q = new URLSearchParams(window.location.search);
    const custom = (q.get("analytics_endpoint") || "").trim();
    if (custom) return custom;
  } catch {
    /* ignore */
  }
  return FALLBACK_ANALYTICS_URL;
}

function sessionId() {
  try {
    const k = "artemis_analytics_sid";
    let id = sessionStorage.getItem(k);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(k, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Stable per-browser id (survives tab close; not cross-browser). */
function persistentUserId() {
  try {
    const k = "artemis_analytics_uid";
    let id = localStorage.getItem(k);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(k, id);
    }
    return id;
  } catch {
    return null;
  }
}

function deviceClass() {
  const w = typeof window.innerWidth === "number" ? window.innerWidth : 0;
  const ua = navigator.userAgent || "";
  if (/(tablet|ipad|playbook|silk)/i.test(ua) || (/(android)/i.test(ua) && !/mobile/i.test(ua))) {
    return "tablet";
  }
  if (/Mobile|Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (w > 0 && w < 640)) {
    return "mobile";
  }
  return "desktop";
}

function browserOsHints() {
  const ua = navigator.userAgent || "";
  let browser = "other";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  else if (/Firefox\//.test(ua)) browser = "Firefox";

  /** iOS Safari reports "Mac OS X" in the UA — detect iPhone/iPad/iPod first. */
  let os = "other";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Linux/.test(ua)) os = "Linux";

  return { browserHint: browser, osHint: os };
}

/**
 * Heuristic device label from screen CSS pixels + OS (exact iPhone generation often ambiguous).
 */
function inferDeviceName(screenW, screenH, osHint, devClass, ua) {
  const sw = Number(screenW) || 0;
  const sh = Number(screenH) || 0;
  if (sw <= 0 || sh <= 0) {
    return `${osHint} · ${devClass}`;
  }
  const a = Math.min(sw, sh);
  const b = Math.max(sw, sh);
  const key = `${a}x${b}`;
  const uaStr = ua || "";

  if (osHint === "iOS") {
    if (/iPad/i.test(uaStr) || devClass === "tablet") {
      return IPAD_BY_CSS.get(key) || `iPad (${a}×${b} CSS px)`;
    }
    if (/iPhone|iPod/i.test(uaStr) || devClass === "mobile") {
      return IPHONE_IPOD_BY_CSS.get(key) || `iPhone (${a}×${b} CSS px)`;
    }
    return `iOS device (${a}×${b} CSS px)`;
  }

  if (osHint === "Android") {
    if (devClass === "tablet") {
      return `Android tablet (${a}×${b} CSS px)`;
    }
    return `Android phone (${a}×${b} CSS px)`;
  }

  if (osHint === "Windows") {
    return devClass === "mobile" ? `Windows mobile (${a}×${b})` : `Windows PC (${a}×${b})`;
  }

  if (osHint === "macOS") {
    return devClass === "desktop" ? `Mac (${a}×${b})` : `Apple device (${a}×${b})`;
  }

  return `${osHint} (${a}×${b})`;
}

function analyticsDebug() {
  try {
    return new URLSearchParams(window.location.search).get("analytics_debug") === "1";
  } catch {
    return false;
  }
}

function buildPayload() {
  const { browserHint, osHint } = browserOsHints();
  const sch =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const sw = screen.width;
  const sh = screen.height;
  const dClass = deviceClass();
  const ua = navigator.userAgent || "";

  return {
    pageUrl: location.href,
    pagePath: location.pathname + location.search,
    referrer: document.referrer || "",
    userAgent: ua,
    screenW: sw,
    screenH: sh,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    language: navigator.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    colorScheme: sch,
    sessionId: sessionId(),
    userId: persistentUserId(),
    deviceClass: dClass,
    browserHint,
    osHint,
    deviceName: inferDeviceName(sw, sh, osHint, dClass, ua),
    devicePixelRatio:
      typeof window.devicePixelRatio === "number" && isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : null,
  };
}

/**
 * Fire-and-forget POST. Safe to call on every full page load.
 */
export function logPageVisit() {
  const url = analyticsEndpoint();
  if (!url) return;

  const headers = { "Content-Type": "application/json" };
  if (typeof window !== "undefined" && window.__ARTEMIS_ANALYTICS_TOKEN__) {
    headers["X-Analytics-Token"] = window.__ARTEMIS_ANALYTICS_TOKEN__;
  }

  const body = JSON.stringify(buildPayload());
  const debug = analyticsDebug();

  // sendBeacon is same-origin only: cross-origin POST + JSON often needs fetch + CORS;
  // mixed content (https page → http API) is blocked — use https:// on FALLBACK_ANALYTICS_URL.
  let sameOriginBeacon = false;
  try {
    const target = new URL(url, location.href);
    sameOriginBeacon =
      typeof navigator.sendBeacon === "function" &&
      !(typeof window !== "undefined" && window.__ARTEMIS_ANALYTICS_TOKEN__) &&
      target.origin === location.origin;
  } catch {
    sameOriginBeacon = false;
  }

  if (sameOriginBeacon) {
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    } catch {
      /* fall through to fetch */
    }
  }

  fetch(url, {
    method: "POST",
    headers,
    body,
    mode: "cors",
    keepalive: true,
    credentials: "omit",
  })
    .then(async (r) => {
      const text = await r.text();
      if (debug) {
        console.info("[analytics]", r.status, text || "(empty body)");
        try {
          const j = text ? JSON.parse(text) : null;
          if (j && j.ok === true) {
            console.info(
              "[analytics] page_visits id",
              j.id,
              "userDevice",
              j.userDevice ?? "?",
              "(table analytics_user_devices when userId valid)"
            );
          }
          if (j && j.ok === false) {
            console.warn("[analytics] server rejected:", j.error, j.hint || "");
          }
        } catch {
          /* not JSON */
        }
      }
      if (!r.ok && debug) {
        console.warn("[analytics] non-OK response", r.status);
      }
    })
    .catch((e) => {
      if (debug) console.warn("[analytics] fetch failed", e);
    });
}

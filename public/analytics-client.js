/**
 * Sends one anonymous page-load record to your analytics API.
 * IP is recorded only on the server from the HTTP request (never from this script).
 *
 * Override URL: ?analytics_endpoint=https://example.com/api/visit.php
 * Optional auth: set window.__ARTEMIS_ANALYTICS_TOKEN__ before the module runs (do not commit secrets).
 */

const FALLBACK_ANALYTICS_URL = "https://noyanov.com/Apps/data/api/visit.php";

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

  let os = "other";
  if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return { browserHint: browser, osHint: os };
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

  return {
    pageUrl: location.href,
    pagePath: location.pathname + location.search,
    referrer: document.referrer || "",
    userAgent: navigator.userAgent || "",
    screenW: screen.width,
    screenH: screen.height,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    language: navigator.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    colorScheme: sch,
    sessionId: sessionId(),
    deviceClass: deviceClass(),
    browserHint,
    osHint,
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

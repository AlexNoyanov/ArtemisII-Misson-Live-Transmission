import { logPageVisit } from "./analytics-client.js";

/** Artemis II published launch (Horizons fallback / cross-check). */
const LAUNCH_MS = Date.parse("2026-04-01T22:35:12.000Z");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const EARTH_RADIUS_MI = 3958.756;
const KM_TO_MI = 0.621371192;
const KPS_TO_MPH = 2236.9362920544;

const POLL_LIVE_MS = 8000;
const POLL_HORIZONS_MS = 30000;

const JINA_ORBIT_BASE = "https://r.jina.ai/http://artemis.cdnspace.ca/api/orbit";

/** Avoid browser/CDN/Jina caching the same orbit JSON between polls. */
function jinaOrbitUrl() {
  return `${JINA_ORBIT_BASE}?_=${Date.now()}`;
}
/** Browser cannot call JPL Horizons directly (CORS). Static hosts often lack /api/horizons — relay via Jina (third party). */
const JINA_HORIZONS = "https://r.jina.ai/https://ssd.jpl.nasa.gov/api/horizons.api";

function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

function horizonsCalendarUtc(d) {
  const mo = MONTHS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mo}-${day} ${hh}:${mm}:${ss}`;
}

function apiPath() {
  if (location.protocol === "file:") return null;
  const params = new URLSearchParams(location.search);
  const siteBase = params.get("site_base") || params.get("horizons_proxy");
  if (siteBase) {
    const root = siteBase.replace(/\/$/, "");
    return (u) => `${root}${u}`;
  }
  return (u) => {
    const rel = u.startsWith("/") ? u.slice(1) : u;
    return new URL(rel, location.href).href;
  };
}

function buildQuery(center, start, stop) {
  const p = new URLSearchParams();
  p.set("format", "json");
  p.set("COMMAND", "'-1024'");
  p.set("OBJ_DATA", "NO");
  p.set("MAKE_EPHEM", "YES");
  p.set("EPHEM_TYPE", "VECTORS");
  p.set("CENTER", `'${center}'`);
  p.set("START_TIME", `'${start}'`);
  p.set("STOP_TIME", `'${stop}'`);
  p.set("STEP_SIZE", "'1 min'");
  p.set("OUT_UNITS", "KM-S");
  return p.toString();
}

function horizonsBodyLooksHtml(text) {
  const t = text.trim().slice(0, 120).toLowerCase();
  return t.startsWith("<!") || t.includes("<html") || t.includes("<!doctype");
}

/** Unwrap Jina Reader JSON → Horizons API JSON string in data.content. */
async function fetchHorizonsViaJinaRelay(center, start, stop) {
  const qs = buildQuery(center, start, stop);
  const url = `${JINA_HORIZONS}?${qs}`;
  const r = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: timeoutSignal(30000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Horizons relay HTTP ${r.status}`);
  const wrapper = await r.json();
  const inner = wrapper?.data?.content;
  if (typeof inner !== "string") throw new Error("Horizons relay: unexpected response shape");
  let data;
  try {
    data = JSON.parse(inner);
  } catch {
    throw new Error("Horizons relay: invalid JSON in content");
  }
  if (data.error) throw new Error(String(data.error));
  if (typeof data.result !== "string") throw new Error("Unexpected Horizons relay body");
  return data.result;
}

async function fetchHorizons(center, start, stop, resolveUrl) {
  const qs = buildQuery(center, start, stop);
  const proxyUrl = resolveUrl(`/api/horizons?${qs}`);
  let r;
  let text;
  try {
    r = await fetch(proxyUrl, { signal: timeoutSignal(25000), cache: "no-store" });
    text = await r.text();
  } catch (e) {
    if (e.name === "AbortError") throw e;
    return fetchHorizonsViaJinaRelay(center, start, stop);
  }

  if (horizonsBodyLooksHtml(text) || r.status === 404 || r.status === 403) {
    return fetchHorizonsViaJinaRelay(center, start, stop);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (r.status === 404 || r.status === 403) return fetchHorizonsViaJinaRelay(center, start, stop);
    throw new Error(`Horizons proxy HTTP ${r.status}: ${text.trim().slice(0, 120)}`);
  }

  if (data.error) throw new Error(String(data.error));
  if (typeof data.result !== "string") {
    if (!r.ok) return fetchHorizonsViaJinaRelay(center, start, stop);
    throw new Error("Unexpected Horizons response");
  }
  if (!r.ok) {
    throw new Error(`Horizons proxy HTTP ${r.status}: ${text.trim().slice(0, 120)}`);
  }
  return data.result;
}

async function fetchLiveTelemetry(resolveUrl) {
  const r = await fetch(resolveUrl("/api/telemetry"), {
    cache: "no-store",
    signal: timeoutSignal(20000),
  });
  if (!r.ok) return null;
  let j;
  try {
    j = await r.json();
  } catch {
    return null;
  }
  if (j.error || j.source !== "live") return null;
  if (
    typeof j.metMs !== "number" ||
    typeof j.speedMph !== "number" ||
    typeof j.earthDistMi !== "number" ||
    typeof j.altitudeMi !== "number"
  ) {
    return null;
  }
  const orbitExtras =
    j.orbitExtras != null && typeof j.orbitExtras === "object" && !Array.isArray(j.orbitExtras)
      ? j.orbitExtras
      : null;
  return { ...j, orbitExtras };
}

/** When /api/telemetry is missing (static hosting), same relay as standalone HTML. */
function orbitExtrasFromOrbit(orbit) {
  if (!orbit || typeof orbit !== "object") return null;
  const o = {};
  if (typeof orbit.speedKmS === "number") o.speedKmS = orbit.speedKmS;
  if (typeof orbit.speedKmH === "number") o.speedKmH = orbit.speedKmH;
  if (typeof orbit.moonDistKm === "number") o.moonDistKm = orbit.moonDistKm;
  if (typeof orbit.periapsisKm === "number") o.periapsisKm = orbit.periapsisKm;
  if (typeof orbit.apoapsisKm === "number") o.apoapsisKm = orbit.apoapsisKm;
  if (typeof orbit.gForce === "number") o.gForce = orbit.gForce;
  return Object.keys(o).length ? o : null;
}

async function fetchLiveTelemetryRelay() {
  const r = await fetch(jinaOrbitUrl(), {
    headers: { Accept: "application/json" },
    signal: timeoutSignal(25000),
    cache: "no-store",
  });
  if (!r.ok) return null;
  const w = await r.json();
  const inner = w?.data?.content;
  if (typeof inner !== "string") return null;
  let orbit;
  try {
    orbit = JSON.parse(inner);
  } catch {
    return null;
  }
  if (typeof orbit.earthDistKm !== "number" || typeof orbit.speedKmS !== "number") return null;
  return {
    source: "live",
    relay: true,
    metMs: orbit.metMs,
    speedMph: orbit.speedKmS * KPS_TO_MPH,
    earthDistMi: orbit.earthDistKm * KM_TO_MI,
    altitudeMi: orbit.altitudeKm * KM_TO_MI,
    earthDistKm: orbit.earthDistKm,
    moonDistKm: orbit.moonDistKm,
    orbitExtras: orbitExtrasFromOrbit(orbit),
  };
}

function parseLastVectorBlock(resultText) {
  const i0 = resultText.indexOf("$$SOE");
  const i1 = resultText.indexOf("$$EOE");
  if (i0 === -1 || i1 === -1 || i1 <= i0) return null;
  const block = resultText.slice(i0, i1);
  const lines = block.split(/\r?\n/);
  let rec = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("A.D.")) continue;
    const vLine = lines[i + 2];
    const rgLine = lines[i + 3];
    if (!vLine || !rgLine) continue;
    const vm = vLine.match(/VX=\s*([^\s]+)\s+VY=\s*([^\s]+)\s+VZ=\s*([^\s]+)/);
    const rgm = rgLine.match(/RG=\s*([+-]?\d+(?:\.\d+)?E[+-]?\d+)/i);
    if (!vm || !rgm) continue;
    rec = {
      vx: Number(vm[1]),
      vy: Number(vm[2]),
      vz: Number(vm[3]),
      rgKm: Number(rgm[1]),
    };
  }
  return rec;
}

function formatCommaInt(n) {
  return Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Hero readout: one decimal so small feed changes are visible (integers often look “stuck”). */
function formatHeroNumber(n) {
  const x = Math.round(Number(n) * 10) / 10;
  return x.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Public orbit CDN often serves unchanged snapshots for a long time; between updates, extrapolate
 * speed/distance/alt along mission time using the last segment where MET actually advanced.
 */
let orbitDrift = {
  rMphPerMetMs: 0,
  rDistPerMetMs: 0,
  rAltPerMetMs: 0,
  met: null,
  mph: null,
  dist: null,
  alt: null,
  /** How many polls in a row returned the same MET (CDN snapshot not advancing). */
  staleMetPolls: 0,
};

function resetOrbitDrift() {
  orbitDrift = {
    rMphPerMetMs: 0,
    rDistPerMetMs: 0,
    rAltPerMetMs: 0,
    met: null,
    mph: null,
    dist: null,
    alt: null,
    staleMetPolls: 0,
  };
}

function updateOrbitDriftFromLive(live) {
  const m = live.metMs;
  const mph = live.speedMph;
  const dist = live.earthDistMi;
  const alt = live.altitudeMi;
  if (orbitDrift.met != null && m === orbitDrift.met) {
    orbitDrift.staleMetPolls += 1;
  } else {
    orbitDrift.staleMetPolls = 0;
  }
  if (orbitDrift.met != null && m > orbitDrift.met) {
    const dm = m - orbitDrift.met;
    orbitDrift.rMphPerMetMs = (mph - orbitDrift.mph) / dm;
    orbitDrift.rDistPerMetMs = (dist - orbitDrift.dist) / dm;
    orbitDrift.rAltPerMetMs = (alt - orbitDrift.alt) / dm;
    if (!Number.isFinite(orbitDrift.rMphPerMetMs) || Math.abs(orbitDrift.rMphPerMetMs) > 0.01) {
      orbitDrift.rMphPerMetMs = 0;
    }
    if (!Number.isFinite(orbitDrift.rDistPerMetMs) || Math.abs(orbitDrift.rDistPerMetMs) > 0.02) {
      orbitDrift.rDistPerMetMs = 0;
    }
    if (!Number.isFinite(orbitDrift.rAltPerMetMs) || Math.abs(orbitDrift.rAltPerMetMs) > 0.02) {
      orbitDrift.rAltPerMetMs = 0;
    }
  }
  orbitDrift.met = m;
  orbitDrift.mph = mph;
  orbitDrift.dist = dist;
  orbitDrift.alt = alt;
}

/**
 * When the public feed repeats the same MET for multiple polls, there is no real d(value)/d(met).
 * Approximate smooth motion using a small fraction of reported speed as nominal radial mi/s (order-of-magnitude
 * for translunar leg — illustrative between upstream refreshes, not navigation-grade).
 */
function staleSnapshotDriftMiPerMs(mph) {
  const miPerSec = mph / 3600;
  const frac = 0.035;
  return (frac * miPerSec) / 1000;
}

function staleSnapshotDriftMphPerMs() {
  const maxDeltaMphPerSec = 0.04;
  return maxDeltaMphPerSec / 1000;
}

function speedMph(vx, vy, vz) {
  const kps = Math.hypot(vx, vy, vz);
  return kps * KPS_TO_MPH;
}

function distanceEarthMi(rgKm) {
  return rgKm * KM_TO_MI;
}

function altitudeMi(rgKm) {
  return Math.max(0, rgKm * KM_TO_MI - EARTH_RADIUS_MI);
}

function trajectoryPhase(earthRgKm, moonRgKm) {
  if (moonRgKm != null && Number.isFinite(moonRgKm) && moonRgKm < 120_000) return "LUNAR VICINITY";
  if (earthRgKm < 100_000) return "EARTH ORBIT";
  return "LUNAR TRANSIT";
}

function formatMETWallClock(nowMs) {
  if (nowMs < LAUNCH_MS) return "PRE-LAUNCH";
  const sec = Math.floor((nowMs - LAUNCH_MS) / 1000);
  return formatSecondsAsMET(sec);
}

function formatMETFromMs(metMs) {
  const sec = Math.floor(metMs / 1000);
  return formatSecondsAsMET(sec);
}

function formatSecondsAsMET(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(d).padStart(2, "0")}:${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function setBanner(msg) {
  const el = document.getElementById("banner");
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function $(id) {
  return document.getElementById(id);
}

let lastGood = null;
let lastFetchAt = 0;
let lastSource = null;
/** Live-feed-only extended orbit fields (speed km/s·h, moon range, apsides, g). */
let lastOrbitExtras = null;

async function refreshTelemetry(resolveUrl) {
  let live = await fetchLiveTelemetry(resolveUrl);
  if (!live && location.protocol !== "file:") {
    try {
      live = await fetchLiveTelemetryRelay();
    } catch {
      live = null;
    }
  }
  if (live) {
    lastSource = live.relay ? "relay" : "live";
    lastOrbitExtras =
      live.orbitExtras != null && typeof live.orbitExtras === "object" && !Array.isArray(live.orbitExtras)
        ? live.orbitExtras
        : null;
    updateOrbitDriftFromLive(live);
    lastGood = {
      source: "live",
      metMs: live.metMs,
      mph: live.speedMph,
      distMi: live.earthDistMi,
      altMi: live.altitudeMi,
      phase: trajectoryPhase(live.earthDistKm, live.moonDistKm),
    };
    lastFetchAt = Date.now();
    return;
  }

  const end = new Date();
  const start = new Date(end.getTime() - 4 * 60 * 1000);
  const stop = new Date(end.getTime() + 2 * 60 * 1000);
  const s = horizonsCalendarUtc(start);
  const t = horizonsCalendarUtc(stop);

  const [earthText, moonText] = await Promise.all([
    fetchHorizons("399", s, t, resolveUrl),
    fetchHorizons("301", s, t, resolveUrl).catch(() => null),
  ]);

  if (earthText.includes("No ephemeris") || earthText.toLowerCase().includes("error")) {
    throw new Error(earthText.slice(0, 200));
  }

  const earth = parseLastVectorBlock(earthText);
  if (!earth) throw new Error("Could not parse Horizons table");

  let moonRgKm = null;
  if (moonText) {
    const moon = parseLastVectorBlock(moonText);
    if (moon) moonRgKm = moon.rgKm;
  }

  lastSource = "horizons";
  lastOrbitExtras = null;
  resetOrbitDrift();
  lastGood = {
    source: "horizons",
    metMs: null,
    mph: speedMph(earth.vx, earth.vy, earth.vz),
    distMi: distanceEarthMi(earth.rgKm),
    altMi: altitudeMi(earth.rgKm),
    phase: trajectoryPhase(earth.rgKm, moonRgKm),
  };
  lastFetchAt = Date.now();
}

function paintOrbitExtras() {
  const dash = "—";
  const x =
    lastOrbitExtras != null && typeof lastOrbitExtras === "object" && !Array.isArray(lastOrbitExtras)
      ? lastOrbitExtras
      : null;
  const set = (id, v) => {
    const el = $(id);
    if (el) el.textContent = v;
  };
  if (!x) {
    ["oe-kms", "oe-kmh", "oe-moon", "oe-peri", "oe-apo", "oe-g"].forEach((id) => set(id, dash));
    return;
  }
  set("oe-kms", x.speedKmS != null ? `${x.speedKmS.toFixed(3)} KM/S` : dash);
  set("oe-kmh", x.speedKmH != null ? `${Math.round(x.speedKmH).toLocaleString("en-US")} KM/H` : dash);
  set("oe-moon", x.moonDistKm != null ? `${formatCommaInt(x.moonDistKm * KM_TO_MI)} MI` : dash);
  set("oe-peri", x.periapsisKm != null ? `${Math.round(x.periapsisKm).toLocaleString("en-US")} KM` : dash);
  set("oe-apo", x.apoapsisKm != null ? `${Math.round(x.apoapsisKm).toLocaleString("en-US")} KM` : dash);
  set("oe-g", x.gForce != null ? `${x.gForce.toFixed(6)} g` : dash);
}

function paint() {
  const now = Date.now();
  // Live feed gives MET at fetch time; advance by wall clock between polls so the display ticks.
  if (lastGood?.metMs != null && typeof lastGood.metMs === "number") {
    const skew = lastFetchAt > 0 ? Math.max(0, now - lastFetchAt) : 0;
    $("met").textContent = formatMETFromMs(lastGood.metMs + skew);
  } else {
    $("met").textContent = formatMETWallClock(now);
  }

  paintOrbitExtras();

  if (!lastGood) return;

  let mphOut = lastGood.mph;
  let distOut = lastGood.distMi;
  let altOut = lastGood.altMi;
  if (
    (lastSource === "live" || lastSource === "relay") &&
    lastGood.metMs != null &&
    typeof lastGood.metMs === "number" &&
    lastFetchAt > 0
  ) {
    const skew = Math.max(0, now - lastFetchAt);
    mphOut += orbitDrift.rMphPerMetMs * skew;
    distOut += orbitDrift.rDistPerMetMs * skew;
    altOut += orbitDrift.rAltPerMetMs * skew;
    if (
      orbitDrift.staleMetPolls >= 1 &&
      orbitDrift.rDistPerMetMs === 0 &&
      orbitDrift.rMphPerMetMs === 0 &&
      orbitDrift.rAltPerMetMs === 0
    ) {
      const kMi = staleSnapshotDriftMiPerMs(lastGood.mph);
      const kMph = staleSnapshotDriftMphPerMs();
      distOut += kMi * skew;
      altOut += kMi * skew;
      mphOut += kMph * skew;
    }
  }

  $("speed-val").textContent = formatHeroNumber(mphOut);
  $("dist-val").textContent = formatHeroNumber(distOut);
  $("alt-val").textContent = `${formatHeroNumber(altOut)} MI`;
  $("phase-val").textContent = lastGood.phase;

  const ageSec = Math.max(0, Math.floor((now - lastFetchAt) / 1000));
  const tag =
    lastSource === "relay"
      ? "Live orbit (relay)"
      : lastSource === "live"
        ? "Live orbit"
        : "Horizons";
  $("data-age").textContent = `${tag} · ${ageSec}s ago`;
}

async function tick(resolveUrl) {
  try {
    await refreshTelemetry(resolveUrl);
    setBanner("");
  } catch (e) {
    console.error(e);
    setBanner(
      lastGood
        ? `Telemetry update failed (showing last good values). ${e.message}`
        : `Telemetry unavailable: ${e.message}`
    );
  }
  paint();
  const delay = lastSource === "live" || lastSource === "relay" ? POLL_LIVE_MS : POLL_HORIZONS_MS;
  setTimeout(() => tick(resolveUrl), delay);
}

function main() {
  logPageVisit();

  const resolveUrl = apiPath();
  if (!resolveUrl) {
    setBanner(
      "Open this app through the local server (npm start) or deploy with the included API proxies. JPL Horizons does not allow browser calls from file:// or cross-origin pages."
    );
    $("met").textContent = "—";
    return;
  }

  $("fuel-val").textContent = "N/A";

  setInterval(() => paint(), 1000);
  void tick(resolveUrl);
}

main();

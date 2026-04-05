/** Artemis II published launch (Horizons fallback / cross-check). */
const LAUNCH_MS = Date.parse("2026-04-01T22:35:12.000Z");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const EARTH_RADIUS_MI = 3958.756;
const KM_TO_MI = 0.621371192;
const KPS_TO_MPH = 2236.9362920544;

const POLL_LIVE_MS = 8000;
const POLL_HORIZONS_MS = 30000;

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
  if (siteBase) return (u) => `${siteBase.replace(/\/$/, "")}${u}`;
  return (u) => u;
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

async function fetchHorizons(center, start, stop, resolveUrl) {
  const qs = buildQuery(center, start, stop);
  const url = resolveUrl(`/api/horizons?${qs}`);
  const r = await fetch(url);
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from proxy");
  }
  if (data.error) throw new Error(String(data.error));
  if (typeof data.result !== "string") throw new Error("Unexpected Horizons response");
  return data.result;
}

async function fetchLiveTelemetry(resolveUrl) {
  const r = await fetch(resolveUrl("/api/telemetry"));
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
  return j;
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

async function refreshTelemetry(resolveUrl) {
  const live = await fetchLiveTelemetry(resolveUrl);
  if (live) {
    lastSource = "live";
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

function paint() {
  const now = Date.now();
  if (lastGood?.source === "live" && lastGood.metMs != null) {
    $("met").textContent = formatMETFromMs(lastGood.metMs);
  } else {
    $("met").textContent = formatMETWallClock(now);
  }

  if (!lastGood) return;

  $("speed-val").textContent = formatCommaInt(lastGood.mph);
  $("dist-val").textContent = formatCommaInt(lastGood.distMi);
  $("alt-val").textContent = `${formatCommaInt(lastGood.altMi)} MI`;
  $("phase-val").textContent = lastGood.phase;

  const ageSec = Math.max(0, Math.floor((now - lastFetchAt) / 1000));
  const tag = lastSource === "live" ? "Live orbit" : "Horizons";
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
  const delay = lastSource === "live" ? POLL_LIVE_MS : POLL_HORIZONS_MS;
  setTimeout(() => tick(resolveUrl), delay);
}

function main() {
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

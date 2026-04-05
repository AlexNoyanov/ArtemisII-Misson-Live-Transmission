/** Live Artemis orbit snapshot (AROW-style), proxied server-side only. */
const LIVE_ORBIT_URL = "https://artemis.cdnspace.ca/api/orbit";

const KM_TO_MI = 0.621371192;
const KPS_TO_MPH = 2236.9362920544;

export async function fetchLiveOrbitPayload() {
  const r = await fetch(LIVE_ORBIT_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const err = new Error(`live orbit HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const orbit = await r.json();
  if (typeof orbit.earthDistKm !== "number" || typeof orbit.speedKmS !== "number") {
    throw new Error("live orbit: unexpected JSON");
  }
  return {
    source: "live",
    metMs: orbit.metMs,
    speedMph: orbit.speedKmS * KPS_TO_MPH,
    earthDistMi: orbit.earthDistKm * KM_TO_MI,
    altitudeMi: orbit.altitudeKm * KM_TO_MI,
    earthDistKm: orbit.earthDistKm,
    moonDistKm: orbit.moonDistKm,
  };
}

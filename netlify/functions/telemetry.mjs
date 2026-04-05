const LIVE_ORBIT_URL = "https://artemis.cdnspace.ca/api/orbit";
const KM_TO_MI = 0.621371192;
const KPS_TO_MPH = 2236.9362920544;

export const handler = async () => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  };
  try {
    const r = await fetch(LIVE_ORBIT_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      return {
        statusCode: r.status,
        headers: { ...headers, "Cache-Control": "no-store" },
        body: JSON.stringify({ error: "upstream", status: r.status }),
      };
    }
    const orbit = await r.json();
    if (typeof orbit.earthDistKm !== "number" || typeof orbit.speedKmS !== "number") {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "unexpected JSON" }),
      };
    }
    const body = JSON.stringify({
      source: "live",
      metMs: orbit.metMs,
      speedMph: orbit.speedKmS * KPS_TO_MPH,
      earthDistMi: orbit.earthDistKm * KM_TO_MI,
      altitudeMi: orbit.altitudeKm * KM_TO_MI,
      earthDistKm: orbit.earthDistKm,
      moonDistKm: orbit.moonDistKm,
    });
    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=5" },
      body,
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: String(e.message) }),
    };
  }
};

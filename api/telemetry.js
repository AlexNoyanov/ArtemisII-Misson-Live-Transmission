import { fetchLiveOrbitPayload } from "../lib/telemetry-live.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const payload = await fetchLiveOrbitPayload();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(payload);
  } catch (e) {
    res.status(502).json({ error: String(e.message) });
  }
}

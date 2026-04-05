export default async function handler(req, res) {
  const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  try {
    const r = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api${q}`, {
      headers: { Accept: "application/json" },
    });
    const text = await r.text();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=30");
    res.status(r.status).send(text);
  } catch (e) {
    res.status(502).json({ error: String(e.message) });
  }
}

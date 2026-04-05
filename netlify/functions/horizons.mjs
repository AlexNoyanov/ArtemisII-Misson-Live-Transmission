export const handler = async (event) => {
  const q =
    event.rawQuery != null && event.rawQuery !== ""
      ? `?${event.rawQuery}`
      : event.queryStringParameters && Object.keys(event.queryStringParameters).length
        ? `?${new URLSearchParams(event.queryStringParameters).toString()}`
        : "";
  const target = `https://ssd.jpl.nasa.gov/api/horizons.api${q}`;
  try {
    const r = await fetch(target, { headers: { Accept: "application/json" } });
    const text = await r.text();
    return {
      statusCode: r.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=30",
      },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: String(e.message) }),
    };
  }
};

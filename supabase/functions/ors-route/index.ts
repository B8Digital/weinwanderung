// Proxy für openrouteservice (foot-hiking) – der ORS-Key bleibt serverseitig (Secret ORS_KEY).
// Deployed als Supabase Edge Function "ors-route" (verify_jwt: false, Zugriff per Origin-Allowlist).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ORS_URL = "https://api.openrouteservice.org/v2/directions/foot-hiking/geojson";
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://b8digital.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);
// Erlaubtes Gebiet (Südsteiermark, großzügig): lon 14.8–16.3, lat 46.3–47.3
const BOX = { minLon: 14.8, maxLon: 16.3, minLat: 46.3, maxLat: 47.3 };

function corsHeaders(origin: string | null) {
  const ok = origin !== null && (ALLOWED.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
    "ok": ok ? "1" : "0",
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const h = corsHeaders(origin);
  const allowed = h.ok === "1";
  delete (h as Record<string, string>).ok;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return json({ error: "POST erwartet" }, 405);
  if (!allowed) return json({ error: "Origin nicht erlaubt" }, 403);

  const key = Deno.env.get("ORS_KEY");
  if (!key) return json({ error: "ORS_KEY nicht gesetzt" }, 500);

  let body: { coordinates?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Ungültiges JSON" }, 400); }
  const coords = body.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || coords.length > 25) return json({ error: "2–25 Koordinaten erwartet" }, 400);
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2 || typeof c[0] !== "number" || typeof c[1] !== "number") return json({ error: "Koordinate ungültig" }, 400);
    const [lon, lat] = c;
    if (lon < BOX.minLon || lon > BOX.maxLon || lat < BOX.minLat || lat > BOX.maxLat) return json({ error: "Koordinate außerhalb des Gebiets" }, 400);
  }

  const payload = { coordinates: coords, elevation: true, instructions: false, units: "km" };
  const r = await fetch(ORS_URL, {
    method: "POST",
    headers: { "Authorization": key, "Content-Type": "application/json", "Accept": "application/json, application/geo+json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  return new Response(text, { status: r.status, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
});

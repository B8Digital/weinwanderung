// Konfiguration – hier den openrouteservice Basic Key eintragen.
window.WW_CONFIG = {
  // Routing läuft über die Supabase Edge Function "ors-route"; der openrouteservice-Key liegt dort als Secret ORS_KEY.
  ROUTE_URL: "https://jfrrtqqyibbkkctkhhoy.supabase.co/functions/v1/ors-route",
  OVERPASS_URL: "https://overpass-api.de/api/interpreter",
  NOMINATIM_URL: "https://nominatim.openstreetmap.org/search",
  // Suchgebiet Südsteirische Weinstraße (Süd, West, Nord, Ost)
  BBOX: [46.67, 15.46, 46.78, 15.66],
  OSM_CACHE_DAYS: 7
};

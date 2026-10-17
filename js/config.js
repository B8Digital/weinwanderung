// Konfiguration der App (Dienste, Gebiet).
window.WW_CONFIG = {
  APP_VERSION: "1.7 · 17.10.2026",            // bei jedem Update anpassen (und ?v= in index.html erhöhen)
  // Routing läuft über die Supabase Edge Function "ors-route"; der openrouteservice-Key liegt dort als Secret ORS_KEY.
  ROUTE_URL: "https://jfrrtqqyibbkkctkhhoy.supabase.co/functions/v1/ors-route",
  // Supabase (Kurzlinks, Anmeldung, später gespeicherte Routen). Publishable Key ist für den Browser bestimmt.
  SUPABASE_URL: "https://jfrrtqqyibbkkctkhhoy.supabase.co",
  SUPABASE_KEY: "sb_publishable_JNvvHPHI6Ia26qvxQT9zAQ_H_qopJZ-",
  OVERPASS_URL: "https://overpass-api.de/api/interpreter",
  NOMINATIM_URL: "https://nominatim.openstreetmap.org/search",
  // Suchgebiet Südsteirische Weinstraße (Süd, West, Nord, Ost)
  BBOX: [46.67, 15.46, 46.78, 15.66],
  OSM_CACHE_DAYS: 7,
  AUTH_ENABLED: false   // Anmeldung vorbereitet, vorerst ausgeblendet
};

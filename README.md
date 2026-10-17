# Weinweg Südsteiermark

Mobile Web-App zum Planen von Wanderrouten entlang der Südsteirischen Weinstraße – von Buschenschank zu Buschenschank, mit Zeitplan, Karte, GPS und Weintaxi-Rückfahrt.

## Funktionen

- Eingabe von Datum, Startzeit, Startpunkt (Liste, Adresssuche oder GPS), „letzte Einkehr spätestens um“, Anzahl Buschenschanken und Wegpunkte, Einkehrdauer, Tempo und Interessen
- Rückweg: Weintaxi (WEINmobil Südsteiermark) zum Ausgangspunkt, zu Fuß zurück oder eigener Endpunkt
- Tagesplan mit Uhrzeiten, Öffnungsstatus, Gehzeiten und Höhenmetern
- Karte (Leaflet + OpenStreetMap) mit Route, Betrieben und eigenem Standort
- Unterwegs-Modus: erledigte Stopps abhaken, „Ab jetzt neu planen“ ab GPS-Standort und aktueller Uhrzeit
- Betriebsdaten werden beim Laden mit OpenStreetMap (Overpass) abgeglichen und ergänzt; eigene Betriebe lassen sich hinzufügen (lokal im Browser gespeichert)
- Route bearbeiten: Stopps auf der Karte oder im Plan entfernen, tauschen oder aufnehmen; Betriebe nach Entfernung ab dem letzten Stopp gegliedert („Nächster Stopp“, „Passend einfügen“)
- Wetter je Stopp und Sonnenuntergang (open-meteo), Höhenprofil aus den Routing-Daten
- Route teilen: Kurzlink (`#t=…`, Tabelle `shared_routes` in Supabase), Kopieren, WhatsApp, E-Mail, System-Teilen; Routen lokal speichern, „Andere Vorschläge“
- Anmeldung per E-Mail-Code (Supabase Auth, ohne Passwort); Tabelle `saved_routes` für nutzerbezogene Routen ist vorbereitet
- Installierbar als PWA (Home-Bildschirm)

## Betrieb

Statische Seite, keine Build-Schritte. Dienste:

| Dienst | Zweck | Key nötig |
| --- | --- | --- |
| openrouteservice (`foot-hiking`) über Supabase Edge Function `ors-route` | Wege, Gehzeiten, Höhenmeter | Key liegt als Secret `ORS_KEY` in Supabase (Projekt `weinweg`), `js/config.js` → `ROUTE_URL` |
| Overpass API | Buschenschanken, Aussichtspunkte, Kirchen, Schlösser | nein |
| Nominatim | Adresssuche | nein |
| OpenStreetMap-Kacheln | Karte | nein |
| open-meteo | Wetter, Sonnenuntergang | nein |
| Supabase (REST + Auth) | Kurzlinks, Anmeldung, gespeicherte Routen | Publishable Key in `js/config.js` (für Browser bestimmt, RLS schützt die Tabellen) |

Ist der Routing-Dienst nicht erreichbar, läuft die App mit Luftlinie × 1,35 als Schätzung. Die Edge Function erlaubt Aufrufe nur von `https://b8digital.github.io` (Secret `ALLOWED_ORIGINS`, kommagetrennt, zum Erweitern) und für höchstens 25 Punkte innerhalb der Steiermark.

Hosting: GitHub Pages (Branch `main`, Root). GPS funktioniert nur über HTTPS.

## Daten pflegen

`js/places.js` enthält die Startdaten (Betriebe, Wegpunkte, Öffnungszeiten). Format:

```js
{id:"koegl", name:"Buschenschank Kögl", kind:"buschenschank", tags:["aussicht"], lat:46.712, lon:15.556,
 addr:"Ratsch 59, 8461 Ehrenhausen", phone:"…", closed:[1,2], hours:{6:[[12,21]],0:[[12,21]]}, note:"…"}
```

`closed`: Wochentage (0 = So … 6 = Sa) mit Ruhetag. `hours`: Öffnungszeiten je Wochentag in Dezimalstunden.

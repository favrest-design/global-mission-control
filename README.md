# 🛸 ANTI-GRAVITY | Global Space Logistics Hub

> **World-Class Real-Time Satellite Tracking & Mission Control System**

A professional-grade satellite tracking platform powered by **CesiumJS** 3D globe and **satellite.js** SGP4 propagation engine.

## ✨ Features

| Feature | Description |
|---|---|
| **3D Globe** | CesiumJS dark Carto basemap with starfield |
| **Live ISS Tracking** | Real-time position via TLE + SGP4 |
| **Multi-Target** | Switch between ISS, Tiangong, Hubble |
| **Territory Intel** | Country/city via reverse geocoding (bigdatacloud → Nominatim → Ocean DB) |
| **Signal Status** | `IN RANGE` / `OUT OF RANGE` with live elevation angle |
| **Footprint Ellipse** | Dynamic coverage area rendered on globe |
| **Laser Data Link** | Glowing GS↔Satellite polyline — cyan when visible, red when blocked |
| **Pass Prediction** | Real SGP4 scan, 24h window, up to 10 contacts |
| **Globe Click GS** | Click anywhere on Earth to instantly place Ground Station |
| **Orbit Trail** | Historical dashed track, last ~6 orbits |

## 🚀 Usage

```bash
python3 -m http.server 8765
# → http://localhost:8765/
```

Open in Chrome/Firefox. Click on the globe to set your Ground Station, then watch the laser link and pass schedule update automatically.

## 📡 Data Sources

- **TLE:** [ivanstanojevic.me](https://tle.ivanstanojevic.me) + CelesTrak fallback
- **Geocoding:** BigDataCloud + OpenStreetMap Nominatim + built-in ocean DB
- **Time:** WorldTimeAPI NTP proxy

## 🛠 Stack

- [CesiumJS 1.108](https://cesium.com) — 3D globe
- [satellite.js 4.0](https://github.com/shashwatak/satellite-js) — SGP4/SDP4
- Vanilla HTML/CSS/JS — zero framework dependencies

## 📁 Project Structure

```
index.html   — Mission Control UI (panel, telemetry, pass table)
script.js    — Engine (TLE fetch, SGP4, geocoding, laser link, pass predictor)
```

---
*Anti-Gravity Space Systems · v1.0*

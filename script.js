// ═══════════════════════════════════════════════════════════════
//  ANTI-GRAVITY | Global Space Logistics Hub
//  World-Class Satellite Tracking & Pass Prediction Engine
//  Powered by satellite.js SGP4 + CesiumJS
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Mission Configuration ──────────────────────────────────────
const SATELLITES = {
    25544: { name: 'ISS (ZARYA)', incl: 51.64 },
    48274: { name: 'TIANGONG (CSS)', incl: 41.47 },
    20580: { name: 'HUBBLE TELESCOPE', incl: 28.47 },
};

const MISSION_CONFIG = {
    TARGET: { norad: 25544, name: 'ISS (ZARYA)' },
    TIME_OFFSET: 0,
    EARTH_R_KM: 6371,
};

// ── State ──────────────────────────────────────────────────────
let viewer = null;
let satelliteEntity = null;
let orbitTrail = null;
let footprintEntity = null;
let laserLinkEntity = null;
let gsEntity = null;
let satrec = null;


let gsLat = null;
let gsLng = null;
let trailPositions = [];
let footprintRadiusM = 2_200_000;
let firstFix = true;

// ── CesiumJS Initialization ────────────────────────────────────
(function initCesium() {
    Cesium.Ion.defaultAccessToken = '';

    viewer = new Cesium.Viewer('cesiumContainer', {
        baseLayer: new Cesium.ImageryLayer(
            new Cesium.UrlTemplateImageryProvider({
                url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                subdomains: ['a', 'b', 'c', 'd'],
                credit: '',
            })
        ),
        timeline: false,
        animation: false,
        homeButton: false,
        sceneModePicker: false,
        baseLayerPicker: false,
        navigationHelpButton: false,
        geocoder: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        skyBox: new Cesium.SkyBox({
            sources: {
                positiveX: 'https://cesium.com/downloads/cesiumjs/releases/1.108/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_px.jpg',
                negativeX: 'https://cesium.com/downloads/cesiumjs/releases/1.108/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mx.jpg',
                positiveY: 'https://cesium.com/downloads/cesiumjs/releases/1.108/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_py.jpg',
                negativeY: 'https://cesium.com/downloads/cesiumjs/releases/1.108/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_my.jpg',
                positiveZ: 'https://cesium.com/downloads/cesiumjs/releases/1.108/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_pz.jpg',
                negativeZ: 'https://cesium.com/downloads/cesiumjs/releases/1.108/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mz.jpg',
            },
        }),
        skyAtmosphere: new Cesium.SkyAtmosphere(),
        shouldAnimate: true,
    });

    // ── Camera Constraints ───────────────────────────────────────
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 100_000;    // 100 km min (no clipping into terrain)
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 25_000_000; // 25 Mm max (no drifting into deep space)
    viewer.scene.screenSpaceCameraController.enableTilt = true;                // Free tilt for cinematic control

    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050a14');

    // Initial cinematic camera
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(0, 15, 18_000_000),
        orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO * 0.65, roll: 0 },
        duration: 0,
    });
})();

// ── Cesium Entities ────────────────────────────────────────────
function setupEntities() {
    // ISS marker
    satelliteEntity = viewer.entities.add({
        id: 'TARGET_ASSET',
        label: {
            text: 'ISS (ZARYA)',
            font: '11px Consolas',
            fillColor: Cesium.Color.fromCssColorString('#00f2ff'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('rgba(0,8,16,0.75)'),
        },
        point: {
            pixelSize: 9,
            color: Cesium.Color.fromCssColorString('#00f2ff'),
            outlineColor: Cesium.Color.fromCssColorString('rgba(0,242,255,0.35)'),
            outlineWidth: 7,
        },
        position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
    });

    // Orbit trail
    orbitTrail = viewer.entities.add({
        id: 'ORBIT_TRAIL',
        polyline: {
            positions: new Cesium.CallbackProperty(() => trailPositions, false),
            width: 1,
            material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString('rgba(0,242,255,0.25)'),
                dashLength: 14,
            }),
            arcType: Cesium.ArcType.NONE,
        },
    });

    // Footprint coverage ellipse
    footprintEntity = viewer.entities.add({
        id: 'FOOTPRINT',
        ellipse: {
            semiMajorAxis: new Cesium.CallbackProperty(() => footprintRadiusM, false),
            semiMinorAxis: new Cesium.CallbackProperty(() => footprintRadiusM, false),
            material: Cesium.Color.fromCssColorString('rgba(0,242,255,0.05)'),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('rgba(0,242,255,0.4)'),
            outlineWidth: 1,
            height: 0,
        },
        position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
    });

    // ── Laser Data Link (GS ↔ Satellite) ──────────────────────────────
    // CallbackProperty renders every frame; hidden until GS is placed
    laserLinkEntity = viewer.entities.add({
        id: 'LASER_DATA_LINK',
        polyline: {
            positions: new Cesium.CallbackProperty(function () {
                if (!satelliteEntity || gsLat === null) return [];
                var satPos = satelliteEntity.position.getValue(Cesium.JulianDate.now());
                if (!satPos) return [];
                return [
                    Cesium.Cartesian3.fromDegrees(gsLng, gsLat, 10),
                    satPos,
                ];
            }, false),
            width: 2,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.25,
                color: Cesium.Color.fromCssColorString('rgba(0,242,255,0.9)'),
            }),
            arcType: Cesium.ArcType.NONE,
            show: new Cesium.CallbackProperty(function () {
                return gsLat !== null;
            }, false),
        },
    });
}

// ── Time Sync ─────────────────────────────────────────────────
async function syncTime() {
    try {
        const t0 = Date.now();
        const r = await fetch('https://worldtimeapi.org/api/timezone/UTC', {
            signal: AbortSignal.timeout(4000),
        });
        const d = await r.json();
        const serverMs = new Date(d.datetime).getTime();
        MISSION_CONFIG.TIME_OFFSET = serverMs - Math.round((t0 + Date.now()) / 2);
    } catch { /* local clock fallback */ }
}

function now() {
    return new Date(Date.now() + MISSION_CONFIG.TIME_OFFSET);
}

// ── TLE Fetch ─────────────────────────────────────────────────
async function fetchLiveTLE(norad) {
    norad = norad ?? MISSION_CONFIG.TARGET.norad;
    setChip('chip-tle', 'TLE FETCH...');

    const sources = [
        `https://tle.ivanstanojevic.me/api/tle/${norad}`,
        `https://celestrak.org/GTLE/TLE/query?CATNR=${norad}&FORMAT=JSON`,
    ];

    for (const url of sources) {
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
            const data = await r.json();

            let l1, l2;
            if (data.line1 && data.line2) {
                l1 = data.line1; l2 = data.line2;
            } else if (Array.isArray(data) && data[0]?.TLE_LINE1) {
                l1 = data[0].TLE_LINE1; l2 = data[0].TLE_LINE2;
            }

            if (l1 && l2) {
                satrec = satellite.twoline2satrec(l1, l2);
                setChip('chip-tle', 'TLE LIVE');
                return;
            }
        } catch { /* try next */ }
    }
    // Ultimate fallback (ISS only)
    if (norad === 25544) {
        const fb = {
            line1: '1 25544U 98067A   26062.51465243  .00009842  00000+0  18068-3 0  9991',
            line2: '2 25544  51.6317 107.6867 0008241 149.4104 210.7366 15.48401384555220',
        };
        satrec = satellite.twoline2satrec(fb.line1, fb.line2);
    }
    setChip('chip-tle', 'TLE FALLBACK');
}

// ── Change Target Satellite ────────────────────────────────────
// ── Satellite Catalog Engine ──────────────────────────────────────
let currentCatalog = [];          // [{name, norad, line1, line2}]
let fleetEntities = new Map();   // norad → Cesium point entity
const FLEET_MAX = 500;

/** Parse plain-text multi-entry TLE into structured array */
function parseTLEText(text) {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
    const sats = [];
    for (let i = 0; i < lines.length - 2; i++) {
        if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
            const norad = parseInt(lines[i + 1].slice(2, 7), 10);
            sats.push({ name: lines[i], norad, line1: lines[i + 1], line2: lines[i + 2] });
            i += 2;
        }
    }
    return sats;
}

/** Fetch a CelesTrak group, populate catalog & render fleet */
async function loadCategory(groupId) {
    const badge = document.getElementById('badge-sat');
    const fleetInfo = document.getElementById('fleet-info');
    const ul = document.getElementById('sat-list');

    if (badge) { badge.textContent = 'LOADING...'; badge.style.color = 'var(--warn)'; }
    if (ul) ul.innerHTML = '<li class="sat-item" style="color:#1a2a3a;pointer-events:none">Fetching catalog...</li>';
    if (fleetInfo) fleetInfo.textContent = '';

    const targetUrl = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${groupId}&FORMAT=tle`;

    // Try multiple fetch strategies to handle CORS / network issues
    const strategies = [
        // 0. Local proxy (server.py) — most reliable, no CORS
        () => fetch(`/proxy/celestrak?GROUP=${groupId}&FORMAT=tle`, { signal: AbortSignal.timeout(20000) }),
        // 1. Direct (works if CelesTrak sends CORS headers)
        () => fetch(targetUrl, { signal: AbortSignal.timeout(10000) }),
        // 2. corsproxy.io
        () => fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, { signal: AbortSignal.timeout(12000) }),
        // 3. allorigins.win
        () => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, { signal: AbortSignal.timeout(12000) }),
    ];


    let text = null;
    for (const attempt of strategies) {
        try {
            const res = await attempt();
            if (!res.ok) continue;
            const body = await res.text();
            // Validate it looks like TLE data (lines starting with '1 ' and '2 ')
            if (body.includes('1 ') && body.includes('2 ')) { text = body; break; }
        } catch { /* try next */ }
    }

    if (!text) {
        if (ul) ul.innerHTML = '<li class="sat-item" style="color:#883300;pointer-events:none">CATALOG UNAVAILABLE — Network blocked</li>';
        if (badge) { badge.textContent = 'OFFLINE'; badge.style.color = '#f84'; }
        return;
    }

    currentCatalog = parseTLEText(text);
    populateSatList(currentCatalog);
    renderFleetDots(currentCatalog);

    const total = currentCatalog.length;
    const shown = Math.min(total, FLEET_MAX);
    if (fleetInfo) {
        fleetInfo.textContent = total > FLEET_MAX
            ? `${total} satellites — fleet: ${shown} sampled`
            : `${total} satellites loaded`;
    }
    if (badge) { badge.textContent = 'ACTIVE'; badge.style.color = 'var(--accent)'; }
}


/** Render scrollable satellite list */
function populateSatList(catalog) {
    const ul = document.getElementById('sat-list');
    if (!ul) return;
    if (!catalog.length) {
        ul.innerHTML = '<li class="sat-item" style="color:#1a2a3a;pointer-events:none">No satellites</li>';
        return;
    }
    ul.innerHTML = catalog.map((s, i) =>
        `<li class="sat-item" data-idx="${i}" onclick="selectFromCatalog(${i})">${s.name}</li>`
    ).join('');
}

/** Filter list by search query */
function filterSatList(query) {
    const ul = document.getElementById('sat-list');
    if (!ul) return;
    const q = query.trim().toLowerCase();
    const filtered = q ? currentCatalog.filter(s => s.name.toLowerCase().includes(q)) : currentCatalog;
    ul.innerHTML = filtered.map(s => {
        const i = currentCatalog.indexOf(s);
        return `<li class="sat-item" data-idx="${i}" onclick="selectFromCatalog(${i})">${s.name}</li>`;
    }).join('');
    if (!ul.innerHTML) ul.innerHTML = '<li class="sat-item" style="color:#1a2a3a;pointer-events:none">No match</li>';
}

/** Position helper accepting an explicit satrec (for fleet rendering) */
function getPositionFromSatrec(sr, date) {
    try {
        const pv = satellite.propagate(sr, date);
        if (!pv.position || typeof pv.position === 'boolean') return null;
        const gmst = satellite.gstime(date);
        const geo = satellite.eciToGeodetic(pv.position, gmst);
        return {
            lat: satellite.radiansToDegrees(geo.latitude),
            lng: satellite.radiansToDegrees(geo.longitude),
            altKm: geo.height,
        };
    } catch { return null; }
}

/** Remove all fleet dot entities */
function clearFleetDots() {
    fleetEntities.forEach(e => viewer.entities.remove(e));
    fleetEntities.clear();
}

/** Render all satellites in catalog as tiny grey dots (max FLEET_MAX) */
function renderFleetDots(catalog) {
    clearFleetDots();
    const t = now();
    // Sample evenly if catalog is larger than FLEET_MAX
    const step = catalog.length > FLEET_MAX ? Math.ceil(catalog.length / FLEET_MAX) : 1;
    const sample = catalog.filter((_, i) => i % step === 0).slice(0, FLEET_MAX);

    for (const sat of sample) {
        try {
            const sr = satellite.twoline2satrec(sat.line1, sat.line2);
            const p = getPositionFromSatrec(sr, t);
            if (!p) continue;
            const entity = viewer.entities.add({
                id: `FLEET_${sat.norad}`,
                position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.altKm * 1000),
                point: {
                    pixelSize: 2,
                    color: Cesium.Color.fromCssColorString('rgba(100,200,220,0.45)'),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
            fleetEntities.set(sat.norad, entity);
        } catch { /* bad TLE — skip */ }
    }
}

/** Switch primary tracking target to a catalog entry */
function selectFromCatalog(idx) {
    const sat = currentCatalog[idx];
    if (!sat) return;

    // Highlight in list
    document.querySelectorAll('.sat-item').forEach(el => el.classList.remove('active'));
    const el = document.querySelector(`.sat-item[data-idx="${idx}"]`);
    if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest' }); }

    // Load TLE directly from catalog (no extra API call needed)
    MISSION_CONFIG.TARGET = { norad: sat.norad, name: sat.name };
    satrec = satellite.twoline2satrec(sat.line1, sat.line2);
    setChip('chip-tle', 'TLE CATALOG');

    // Parse inclination from TLE line 2 (chars 8-16)
    const incl = parseFloat(sat.line2.slice(8, 16));
    if (!isNaN(incl)) setText('inclination', `${incl.toFixed(2)}°`);

    // Update Cesium label
    if (satelliteEntity) satelliteEntity.label.text = sat.name;

    // Reset trail, release camera, clear look-lines
    trailPositions = [];
    viewer.trackedEntity = undefined;
    viewer.entities.values
        .filter(e => ['ORBIT_PREVIEW', ...Array.from({ length: 3 }, (_, i) => `LOOK_${i}`)].includes(e.id))
        .forEach(e => viewer.entities.remove(e));

    // Clear territory
    const locEl = document.getElementById('location-name');
    if (locEl) { locEl.textContent = 'ACQUIRING...'; locEl.style.color = 'var(--warn)'; }
    lastGeoLat = null;
    firstFix = false;

    // Cinematic flyTo → then lock camera
    viewer.flyTo(satelliteEntity, {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 8_000_000),
    }).then(() => { viewer.trackedEntity = satelliteEntity; });

    console.log(`[CATALOG] Target: ${sat.name} (NORAD ${sat.norad})`);
}

// ── changeTarget() — Legacy shim (still called by old HTML if any) ───────
async function changeTarget(norad) {
    norad = parseInt(norad, 10);
    // Try to find in current catalog first (instant, no extra fetch)
    const idx = currentCatalog.findIndex(s => s.norad === norad);
    if (idx >= 0) { selectFromCatalog(idx); return; }
    // Fallback: fetch individual TLE and inject into catalog temporarily
    const meta = SATELLITES[norad] ?? { name: `NORAD ${norad}`, incl: '--' };
    await fetchLiveTLE(norad);
    MISSION_CONFIG.TARGET = { norad, name: meta.name };
    if (satelliteEntity) satelliteEntity.label.text = meta.name;
    setText('inclination', `${meta.incl}°`);
    trailPositions = [];
    viewer.trackedEntity = undefined;
    firstFix = false;
    viewer.flyTo(satelliteEntity, {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 8_000_000),
    }).then(() => { viewer.trackedEntity = satelliteEntity; });
}

// ── Satellite Position (primary tracker) ────────────────────────
function getPosition(date) {
    if (!satrec) return null;
    try {
        const pv = satellite.propagate(satrec, date);
        if (!pv.position || typeof pv.position === 'boolean') return null;
        const gmst = satellite.gstime(date);
        const geo = satellite.eciToGeodetic(pv.position, gmst);
        const v = pv.velocity;
        return {
            lat: satellite.radiansToDegrees(geo.latitude),
            lng: satellite.radiansToDegrees(geo.longitude),
            altKm: geo.height,
            kmps: Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2),
        };
    } catch { return null; }
}

// ── Reverse Geocoding (Territory Intel) ───────────────────────
let lastGeoLat = null;
let lastGeoLng = null;
let geoThrottle = 0;

const OCEANS = [
    { name: 'Arctic Ocean', latMin: 70, latMax: 90, lngMin: -180, lngMax: 180 },
    { name: 'North Atlantic Ocean', latMin: 0, latMax: 70, lngMin: -80, lngMax: 20 },
    { name: 'South Atlantic Ocean', latMin: -70, latMax: 0, lngMin: -70, lngMax: 25 },
    { name: 'North Pacific Ocean', latMin: 0, latMax: 70, lngMin: -180, lngMax: -70 },
    { name: 'South Pacific Ocean', latMin: -70, latMax: 0, lngMin: -180, lngMax: -70 },
    { name: 'Indian Ocean', latMin: -70, latMax: 30, lngMin: 20, lngMax: 110 },
    { name: 'Southern Ocean', latMin: -90, latMax: -55, lngMin: -180, lngMax: 180 },
    { name: 'Mediterranean Sea', latMin: 30, latMax: 47, lngMin: -6, lngMax: 42 },
];

function okyanusAdi(lat, lng) {
    for (const o of OCEANS) {
        if (lat >= o.latMin && lat <= o.latMax && lng >= o.lngMin && lng <= o.lngMax)
            return o.name;
    }
    return 'Open Ocean';
}

async function reverseGeocode(lat, lng) {
    const nowMs = Date.now();
    const dist = lastGeoLat !== null
        ? Math.abs(lat - lastGeoLat) + Math.abs(lng - lastGeoLng)
        : 999;

    // Throttle: skip if <15s elapsed AND moved <0.3 degrees
    if (nowMs - geoThrottle < 15_000 && dist < 0.3) return;
    geoThrottle = nowMs;
    lastGeoLat = lat; lastGeoLng = lng;

    const locEl = document.getElementById('location-name');
    const sigEl = document.getElementById('signal-status');
    if (!locEl) return;

    // ── Source 1: bigdatacloud (fast, city-level, no rate-limit) ────────
    try {
        const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&localityLanguage=en`;
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        const data = await res.json();

        const country = data.countryName || '';
        const city = data.city || data.locality || data.principalSubdivision || '';

        if (country) {
            const territory = city ? `${country} / ${city}` : country;
            locEl.textContent = territory;
            locEl.style.color = 'var(--warn)';
            if (sigEl) { sigEl.textContent = 'LAND COVERAGE'; sigEl.style.color = '#00e676'; }
            return;
        }
        // No country → likely ocean, fall through
    } catch { /* fall through */ }

    // ── Source 2: Nominatim (country + ocean names) ──────────────────────
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&format=json&zoom=3`;
        const res = await fetch(url, {
            headers: { 'Accept-Language': 'en-US,en' },
            signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        const addr = data.address || {};
        const country = addr.country || '';
        const region = addr.state || addr.county || addr.region || '';
        const ocean = addr.body_of_water || addr.ocean || addr.sea || '';

        if (ocean) {
            locEl.textContent = ocean;
            locEl.style.color = 'var(--accent)';
            if (sigEl) { sigEl.textContent = 'OCEAN COVERAGE'; sigEl.style.color = 'var(--accent)'; }
        } else if (country) {
            const territory = region ? `${country} / ${region}` : country;
            locEl.textContent = territory;
            locEl.style.color = 'var(--warn)';
            if (sigEl) { sigEl.textContent = 'LAND COVERAGE'; sigEl.style.color = '#00e676'; }
        } else {
            throw new Error('empty');
        }
        return;
    } catch { /* fall through */ }

    // ── Source 3: built-in ocean DB ──────────────────────────────────────
    const ocean = okyanusAdi(lat, lng);
    locEl.textContent = ocean;
    locEl.style.color = 'var(--accent)';
    if (sigEl) { sigEl.textContent = 'INT\'L WATERS'; sigEl.style.color = 'var(--accent)'; }
}

// ── Real-Time Update Loop ──────────────────────────────────────
function tick() {
    const t = now();
    const pos = getPosition(t);
    if (!pos) return;

    const { lat, lng, altKm, kmps } = pos;

    // Telemetry DOM
    setText('lat', `${lat.toFixed(4)}°`);
    setText('lng', `${lng.toFixed(4)}°`);
    setText('alt', `${Math.round(altKm)} km`);
    setText('vel', `${kmps.toFixed(3)} km/s`);
    setText('utc-time', t.toISOString().slice(11, 19) + ' Z');
    setChip('chip-time', 'UTC ' + t.toISOString().slice(11, 19));

    // Inclination from active satellite catalog
    const meta = SATELLITES[MISSION_CONFIG.TARGET.norad];
    if (meta) setText('inclination', `${meta.incl}°`);

    // Footprint
    const R = MISSION_CONFIG.EARTH_R_KM;
    const rho = Math.acos(R / (R + altKm));
    const fpKm = R * rho;
    footprintRadiusM = fpKm * 1000;
    const fpM2 = (Math.PI * fpKm * fpKm / 1e6).toFixed(2);
    setText('footprint', `${Math.round(fpKm).toLocaleString()} km`);
    setText('footprint-area', `${fpM2} M km²`);

    // Territory intelligence (throttled reverse geocoding)
    reverseGeocode(lat, lng);

    // ── Laser visibility: elevation check ─────────────────────────────
    // If a GS is placed, calculate whether satellite is above horizon.
    // Update laser color and overwrite Signal Status accordingly.
    if (gsLat !== null && laserLinkEntity) {
        try {
            const obzGd = {
                latitude: satellite.degreesToRadians(gsLat),
                longitude: satellite.degreesToRadians(gsLng),
                height: 0,
            };
            const pv = satellite.propagate(satrec, t);
            const gmst = satellite.gstime(t);
            const posEcf = satellite.eciToEcf(pv.position, gmst);
            const look = satellite.ecfToLookAngles(obzGd, posEcf);
            const elDeg = satellite.radiansToDegrees(look.elevation);
            const inView = elDeg > 0;

            // Glow color: cyan when visible, red-orange when below horizon
            const color = inView
                ? Cesium.Color.fromCssColorString('rgba(0,242,255,0.9)')
                : Cesium.Color.fromCssColorString('rgba(255,80,40,0.55)');
            laserLinkEntity.polyline.material = new Cesium.PolylineGlowMaterialProperty({
                glowPower: inView ? 0.28 : 0.1,
                color,
            });

            // Override Signal Status with visibility — more tactical than land/ocean
            const sigEl = document.getElementById('signal-status');
            if (sigEl) {
                if (inView) {
                    sigEl.textContent = `IN RANGE  ${elDeg.toFixed(1)}°`;
                    sigEl.style.color = '#00f2ff';
                } else {
                    sigEl.textContent = `OUT OF RANGE  ${elDeg.toFixed(1)}°`;
                    sigEl.style.color = 'rgba(255,80,40,0.85)';
                }
            }
        } catch { /* propagation error — skip */ }
    }

    const cartPos = Cesium.Cartesian3.fromDegrees(lng, lat, altKm * 1000);
    satelliteEntity.position = cartPos;
    footprintEntity.position = Cesium.Cartesian3.fromDegrees(lng, lat, 500);

    trailPositions.push(Cesium.Cartesian3.fromDegrees(lng, lat, altKm * 1000));
    if (trailPositions.length > 380) trailPositions.shift();

    // First fix: fly camera to ISS + draw orbit preview
    if (firstFix) {
        firstFix = false;
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lng, lat, 13_000_000),
            orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO * 0.7, roll: 0 },
            duration: 2,
        });
        drawOrbitPreview(t);
    }
}

function drawOrbitPreview(startDate) {
    const pts = [];
    for (let m = 0; m <= 185; m++) {
        const p = getPosition(new Date(startDate.getTime() + m * 60_000));
        if (p) pts.push(Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.altKm * 1000));
    }
    viewer.entities.add({
        id: 'ORBIT_PREVIEW',
        polyline: {
            positions: pts,
            width: 0.6,
            material: Cesium.Color.fromCssColorString('rgba(0,242,255,0.1)'),
            arcType: Cesium.ArcType.NONE,
        },
    });
}

// ── Ground Station ─────────────────────────────────────────────
function setGS(lat, lng, label) {
    gsLat = lat; gsLng = lng;
    setText('gs-name', label);
    setChip('chip-gs', `GS ${lat.toFixed(2)},${lng.toFixed(2)}`);

    if (gsEntity) viewer.entities.remove(gsEntity);
    gsEntity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lng, lat, 10),
        point: {
            pixelSize: 7,
            color: Cesium.Color.fromCssColorString('#ffd740'),
            outlineWidth: 5,
            outlineColor: Cesium.Color.fromCssColorString('rgba(255,215,64,0.3)'),
        },
        label: {
            text: label,
            font: '10px Consolas',
            fillColor: Cesium.Color.fromCssColorString('#ffd740'),
            pixelOffset: new Cesium.Cartesian2(0, -16),
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('rgba(0,8,16,0.8)'),
        },
    });
}

function acquireGS() {
    const lat = parseFloat(document.getElementById('gsLat').value);
    const lng = parseFloat(document.getElementById('gsLng').value);

    if (!isNaN(lat) && !isNaN(lng)) {
        setGS(lat, lng, `MANUAL_GS (${lat.toFixed(2)}° ${lng.toFixed(2)}°)`);
        return;
    }

    if (!navigator.geolocation) {
        setGS(0, 0, 'GS_EQUATORIAL_REF');
        return;
    }

    const btn = document.querySelector('[onclick="acquireGS()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'ACQUIRING...'; }

    navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
            setGS(coords.latitude, coords.longitude, 'PRIMARY_GS_01');
            if (btn) { btn.disabled = false; btn.textContent = 'GPS ACQUIRE'; }
        },
        () => {
            // No hardcoded fallback city - use equatorial reference
            setGS(0, 0, 'GS_REFERENCE (0°,0°)');
            if (btn) { btn.disabled = false; btn.textContent = 'GPS ACQUIRE'; }
        },
        { timeout: 8000, enableHighAccuracy: true }
    );
}

// ── Pass Prediction (Real SGP4) ───────────────────────────────
function calculateLogistics() {
    const lat = gsLat ?? 0;
    const lng = gsLng ?? 0;

    if (gsLat === null) setGS(lat, lng, 'GS_REFERENCE (0°,0°)');

    const btn = document.getElementById('calcBtn');
    const tbody = document.getElementById('pass-body');
    if (btn) { btn.disabled = true; btn.textContent = 'COMPUTING...'; }
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#1a2a3a;padding:12px">SCANNING 24H WINDOW...</td></tr>';

    setTimeout(() => {
        try {
            const passes = scanPasses(lat, lng);
            renderPasses(passes);
            drawLookLines(passes);
            const passCount = document.getElementById('pass-count');
            if (passCount) passCount.textContent = `${passes.length} CONTACTS`;
        } catch (e) {
            document.getElementById('pass-body').innerHTML =
                '<tr><td colspan="4" style="text-align:center;color:#445">COMPUTATION ERROR</td></tr>';
        }
        if (btn) { btn.disabled = false; btn.textContent = 'RUN PASS PREDICTION'; }
    }, 30);
}

function scanPasses(obsLat, obsLng, obsAltKm = 0) {
    const obzGd = {
        latitude: satellite.degreesToRadians(obsLat),
        longitude: satellite.degreesToRadians(obsLng),
        height: obsAltKm,
    };

    const passes = [];
    const t0 = now();
    const stepMs = 30_000;
    const horizMs = 24 * 60 * 60 * 1000;
    let active = null;

    for (let ms = 0; ms <= horizMs; ms += stepMs) {
        const t = new Date(t0.getTime() + ms);
        const pv = satellite.propagate(satrec, t);
        if (!pv.position || typeof pv.position === 'boolean') continue;

        const gmst = satellite.gstime(t);
        const posEcf = satellite.eciToEcf(pv.position, gmst);
        const look = satellite.ecfToLookAngles(obzGd, posEcf);
        const elDeg = satellite.radiansToDegrees(look.elevation);
        const azDeg = satellite.radiansToDegrees(look.azimuth);

        if (elDeg > 0) {
            if (!active) {
                active = { start: t, startAz: azDeg, maxEl: elDeg, maxAzTime: t };
            }
            if (elDeg > active.maxEl) {
                active.maxEl = elDeg;
                active.maxAzTime = t;
                active.peakAz = azDeg;
            }
            active.end = t;
            active.endAz = azDeg;
        } else if (active) {
            active.durMin = Math.round((active.end - active.start) / 60_000);
            passes.push(active);
            active = null;
            if (passes.length >= 10) break;
        }
    }

    return passes;
}

function azLabel(az) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(az / 45) % 8];
}

function renderPasses(passes) {
    const tbody = document.getElementById('pass-body');
    if (!passes.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#1a2a3a;padding:10px">NO CONTACTS IN WINDOW</td></tr>';
        return;
    }

    tbody.innerHTML = passes.map(p => {
        const t = p.start.toISOString().slice(11, 19);
        const el = p.maxEl.toFixed(1);
        const dur = `${p.durMin}m`;
        const az = `${azLabel(p.startAz)}→${azLabel(p.endAz)}`;
        const cls = p.maxEl > 45 ? 'q-high' : p.maxEl > 15 ? 'q-med' : 'q-low';
        return `<tr>
            <td>${t} Z</td>
            <td class="${cls}">${el}°</td>
            <td>${dur}</td>
            <td style="color:#2a3a4a">${az}</td>
        </tr>`;
    }).join('');
}

function drawLookLines(passes) {
    viewer.entities.values
        .filter(e => e.id?.startsWith('LOOK_'))
        .forEach(e => viewer.entities.remove(e));

    passes.slice(0, 3).forEach((p, i) => {
        const pos = getPosition(p.maxAzTime ?? p.start);
        if (!pos || gsLat === null) return;
        viewer.entities.add({
            id: `LOOK_${i}`,
            polyline: {
                positions: [
                    Cesium.Cartesian3.fromDegrees(gsLng, gsLat, 10),
                    Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, pos.altKm * 1000),
                ],
                width: 0.8,
                material: new Cesium.PolylineDashMaterialProperty({
                    color: Cesium.Color.fromCssColorString('rgba(255,215,64,0.3)'),
                    dashLength: 10,
                }),
                arcType: Cesium.ArcType.NONE,
            },
        });
    });
}

// ── Helpers ────────────────────────────────────────────────────
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function setChip(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ── Boot Sequence ──────────────────────────────────────────────
async function boot() {
    console.log('%c◈ ANTI-GRAVITY LOGISTICS ENGINE BOOT', 'color:#00f2ff;font-weight:bold;font-size:1rem');
    setupEntities();
    await Promise.all([fetchLiveTLE(), syncTime()]);
    tick(); // immediate first render
    setInterval(tick, 1000);
    setInterval(fetchLiveTLE, 10 * 60 * 1000);
    setInterval(syncTime, 30 * 60 * 1000);

    // Pre-load Space Stations catalog (ISS, Tiangong, etc.) on startup
    await loadCategory('stations');
    // Auto-select ISS
    const issIdx = currentCatalog.findIndex(s => s.norad === 25544);
    if (issIdx >= 0) selectFromCatalog(issIdx);

    console.log('%c◈ ALL SYSTEMS NOMINAL', 'color:#00e676;font-weight:bold');
}

boot();

// ── Globe Click → Set Ground Station ─────────────────────────
// Click anywhere on the Cesium 3D globe to instantly place the GS
// and draw the glowing laser data link to the satellite
(function initClickHandler() {
    // Wait until viewer is ready (boot() runs first)
    var handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction(function (movement) {
        // Don't steal clicks on the overlay panel or UI buttons
        var el = document.elementFromPoint(movement.position.x, movement.position.y);
        if (el && el.closest('#overlay')) return;

        var cartesian = viewer.camera.pickEllipsoid(
            movement.position,
            viewer.scene.globe.ellipsoid
        );
        if (!cartesian) return;

        var carto = Cesium.Cartographic.fromCartesian(cartesian);
        var clickLat = Cesium.Math.toDegrees(carto.latitude);
        var clickLng = Cesium.Math.toDegrees(carto.longitude);

        // Set ground station via existing function
        setGS(clickLat, clickLng,
            'GS CLICK (' + clickLat.toFixed(2) + '°, ' + clickLng.toFixed(2) + '°)'
        );

        // Sync panel inputs
        var latEl = document.getElementById('gsLat');
        var lngEl = document.getElementById('gsLng');
        if (latEl) latEl.value = clickLat.toFixed(4);
        if (lngEl) lngEl.value = clickLng.toFixed(4);

        // Auto-run pass prediction
        calculateLogistics();

        console.log('Mission Control: GS set via globe click at',
            clickLat.toFixed(4), clickLng.toFixed(4));
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
})();

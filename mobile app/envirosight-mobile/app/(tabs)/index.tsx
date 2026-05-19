import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, ScrollView, StyleSheet, Platform, Pressable, ActivityIndicator,
} from "react-native";
import {
  API_BASE,
  AirNowStation,
  ColorByMetric,
  FeatureProperties,
  GeoJsonFeature,
  METRIC_LABELS,
  RISK_COLORS,
  SuperfundSite,
  TriFacility,
  buildQuintileColorFn,
  formatNumber,
  getCommunity,
  getCrowdedHousing,
  getDisplayRiskScore,
  getGreenRisk,
  getHeatRisk,
  getIncome,
  getMetricValue,
  getNoHsDiploma,
  getPoverty,
  getRiskLevel,
  getSatelliteAirPollutionScore,
  getSesVulnerability,
  getUnemployment,
  getValue,
  sharedStyles,
  toNumber,
} from "@/lib/envirosight";

type Pin = { lat: number; lng: number; label: string };
type BasemapType = "street" | "satellite";

type WeatherCondition = { code: number; label: string; emoji: string };
type WeatherCurrent = {
  time: string; temperature_f: number; feels_like_f: number; humidity_pct: number;
  precipitation_in: number; wind_speed_mph: number; wind_direction_deg: number;
  uv_index: number; is_day: boolean; weather: WeatherCondition;
};
type WeatherDay = {
  date: string; temp_max_f: number; temp_min_f: number; precip_prob_pct: number;
  wind_max_mph: number; uv_max: number; sunrise: string; sunset: string; weather: WeatherCondition;
};
type WeatherAlert = {
  id: string; event: string; severity: string; urgency: string;
  headline: string; description: string; instruction: string;
  sent: string; expires: string; sender_name: string;
};
type WeatherData = {
  available: boolean; current?: WeatherCurrent; daily?: WeatherDay[]; location?: string;
  alerts?: WeatherAlert[];
};

function windDirectionLabel(deg: number): string {
  if (!Number.isFinite(deg)) return "—";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function formatHour(isoTime: string): string {
  if (!isoTime) return "—";
  try {
    return new Date(isoTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch { return "—"; }
}

function shortDayName(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr + "T12:00:00").toLocaleDateString([], { weekday: "short" });
  } catch { return "—"; }
}

function pointInRing(point: [number, number], ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lat: number, lng: number, geometry: any): boolean {
  if (!geometry) return false;
  const point: [number, number] = [lng, lat];
  if (geometry.type === "Polygon") {
    if (!pointInRing(point, geometry.coordinates[0])) return false;
    for (let i = 1; i < geometry.coordinates.length; i++) {
      if (pointInRing(point, geometry.coordinates[i])) return false;
    }
    return true;
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      if (pointInRing(point, polygon[0])) {
        let inHole = false;
        for (let i = 1; i < polygon.length; i++) {
          if (pointInRing(point, polygon[i])) { inHole = true; break; }
        }
        if (!inHole) return true;
      }
    }
    return false;
  }
  return false;
}

const meteoconUrl = (code: number, isDay: boolean = true): string => {
  const base = "https://cdn.jsdelivr.net/gh/basmilius/weather-icons/production/fill/all";
  const dn = isDay ? "day" : "night";
  const map: Record<number, string> = {
    0: `clear-${dn}`, 1: `clear-${dn}`, 2: `partly-cloudy-${dn}`, 3: `overcast-${dn}`,
    45: `fog-${dn}`, 48: `fog-${dn}`, 51: "drizzle", 53: "drizzle", 55: "drizzle",
    56: "sleet", 57: "sleet", 61: "rain", 63: "rain", 65: "rain", 66: "sleet", 67: "sleet",
    71: "snow", 73: "snow", 75: "snow", 77: "snow",
    80: `partly-cloudy-${dn}-rain`, 81: "rain", 82: "thunderstorms-rain",
    85: `partly-cloudy-${dn}-snow`, 86: "snow",
    95: "thunderstorms", 96: "thunderstorms-rain", 99: "thunderstorms-rain",
  };
  const icon = map[code] ?? `clear-${dn}`;
  return `${base}/${icon}.svg`;
};

export default function HomeScreen() {
  const [geoData, setGeoData] = useState<any>(null);
  const [airnowStations, setAirnowStations] = useState<AirNowStation[]>([]);
  const [triFacilities, setTriFacilities] = useState<TriFacility[]>([]);
  const [superfundSites, setSuperfundSites] = useState<SuperfundSite[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);

  const [showAirnow, setShowAirnow] = useState(true);
  const [showTri, setShowTri] = useState(true);
  const [showSuperfund, setShowSuperfund] = useState(true);
  const [colorBy, setColorBy] = useState<ColorByMetric>("risk");
  const [basemap, setBasemap] = useState<BasemapType>("street");

  const [addressQuery, setAddressQuery] = useState("");
  const [pin, setPin] = useState<Pin | null>(null);
  const [pinMatchedFeature, setPinMatchedFeature] = useState<FeatureProperties | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const [search, setSearch] = useState("");
  const [dataSource, setDataSource] = useState("Loading...");
  const [dataStatus, setDataStatus] = useState<"loading" | "live" | "backup" | "error">("loading");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/current-risk-map`);
        if (!res.ok) throw new Error(`Backend ${res.status}`);
        const data = await res.json();
        const ts = data.features?.[0]?.properties?.current_readings_generated_at_utc;
        if (ts && ts !== "Saved file") {
          setDataStatus("live");
          setDataSource("Live satellite + public health");
          setGeneratedAt(ts);
        } else {
          setDataStatus("backup");
          setDataSource("Saved backup data");
        }
        setGeoData(data);
      } catch {
        try {
          const res = await fetch("/data/chicago_risk_map.geojson");
          setGeoData(await res.json());
          setDataStatus("backup");
          setDataSource("Static GeoJSON (backend offline)");
        } catch {
          setDataStatus("error");
          setDataSource("Failed to load data");
        }
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try { await fetch(`${API_BASE}/health`); } catch {}
      try {
        const [s, tri, sf, w] = await Promise.all([
          fetch(`${API_BASE}/api/airnow-stations`),
          fetch(`${API_BASE}/api/tri-facilities`, { signal: AbortSignal.timeout(60000) }),
          fetch(`${API_BASE}/api/superfund-sites`),
          fetch(`${API_BASE}/api/weather`),
        ]);
        if (s.ok) {
          const d = await s.json();
          if (d.available && Array.isArray(d.stations)) setAirnowStations(d.stations);
        }
        if (tri.ok) {
          const d = await tri.json();
          if (d.available && Array.isArray(d.facilities)) setTriFacilities(d.facilities);
        }
        if (sf.ok) {
          const d = await sf.json();
          if (d.available && Array.isArray(d.sites)) setSuperfundSites(d.sites);
        }
        if (w.ok) {
          const wd = await w.json();
          if (wd.available) setWeather(wd);
        }
      } catch (err) {
        console.warn("Extras fetch failed:", err);
      }
    })();
  }, []);

  const explain = (p: any): string => {
    const name = getCommunity(p);
    const score = getDisplayRiskScore(p);
    const level = getRiskLevel(score).toLowerCase();
    const factors: string[] = [];
    if (getSatelliteAirPollutionScore(p) >= 60) factors.push("high satellite-measured air pollution");
    if (getHeatRisk(p) >= 60) factors.push("elevated land surface temperatures (urban heat)");
    if (getGreenRisk(p) >= 60) factors.push("limited green space and tree cover");
    if (toNumber(getValue(p, ["no2_pollution_score"], 0)) >= 70) factors.push("very high NO₂");
    if (toNumber(getValue(p, ["pm25_proxy_pollution_score"], 0)) >= 70) factors.push("elevated PM2.5");
    const poverty = getPoverty(p);
    const sesContext = Number.isFinite(poverty) ? ` (${poverty.toFixed(1)}% below poverty)` : "";
    if (factors.length === 0) return `${name} is rated ${level} compared to other Chicago community areas${sesContext}.`;
    if (factors.length === 1) return `${name} is rated ${level}, driven primarily by ${factors[0]}${sesContext}.`;
    return `${name} is rated ${level}, driven by ${factors.slice(0, -1).join(", ")} and ${factors[factors.length - 1]}${sesContext}.`;
  };

  const findFeatureAtPoint = (lat: number, lng: number): FeatureProperties | null => {
    if (!geoData?.features) return null;
    for (const f of geoData.features as GeoJsonFeature[]) {
      if (pointInGeometry(lat, lng, f.geometry)) return f.properties;
    }
    return null;
  };

  const dropPinAt = (lat: number, lng: number, label: string) => {
    setPin({ lat, lng, label });
    setPinMatchedFeature(findFeatureAtPoint(lat, lng));
  };

  const geocodeAddress = async () => {
    const q = addressQuery.trim();
    if (!q) return;
    setGeocoding(true);
    setGeocodeError(null);
    try {
      const url = "https://nominatim.openstreetmap.org/search?" +
        "format=json&limit=1&countrycodes=us&bounded=1" +
        "&viewbox=-88.0,42.05,-87.5,41.6" +
        `&q=${encodeURIComponent(q + " Chicago, IL")}`;
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        setGeocodeError("No address found in Chicago. Try adding more detail.");
        setPin(null); setPinMatchedFeature(null);
        return;
      }
      const result = data[0];
      dropPinAt(parseFloat(result.lat), parseFloat(result.lon),
        result.display_name?.split(",").slice(0, 2).join(", ") || q);
    } catch (err: any) {
      setGeocodeError(`Geocoding failed: ${err?.message || "network error"}`);
    } finally {
      setGeocoding(false);
    }
  };

  const useMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeocodeError("Geolocation not supported by this browser.");
      return;
    }
    setLocating(true);
    setGeocodeError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        if (lat < 41.5 || lat > 42.1 || lng < -88.1 || lng > -87.4) {
          setGeocodeError(`Your location (${lat.toFixed(3)}, ${lng.toFixed(3)}) is outside Chicago.`);
        }
        dropPinAt(lat, lng, "Your location");
        setLocating(false);
      },
      (err) => { setGeocodeError(`Location error: ${err.message}`); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const clearPin = () => {
    setPin(null); setPinMatchedFeature(null);
    setAddressQuery(""); setGeocodeError(null);
  };

  const allNeighborhoods: FeatureProperties[] = geoData?.features?.map((f: GeoJsonFeature) => f.properties) || [];
  const ranked = useMemo(
    () => [...allNeighborhoods].sort((a, b) => getDisplayRiskScore(b) - getDisplayRiskScore(a)),
    [geoData]
  );

  const isReversed = colorBy === "income";
  const getMetricColor = useMemo(
    () => buildQuintileColorFn(ranked.map((p) => getMetricValue(p, colorBy)), isReversed),
    [ranked, colorBy, isReversed]
  );
  const quintiles = useMemo(() => {
    if (ranked.length === 0) return [0, 0, 0, 0];
    const values = ranked.map((p) => getMetricValue(p, colorBy)).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length === 0) return [0, 0, 0, 0];
    return [0.2, 0.4, 0.6, 0.8].map((p) => values[Math.floor(values.length * p)]);
  }, [ranked, colorBy]);

  const selected = search.length > 0
    ? allNeighborhoods.find((item) => getCommunity(item).toLowerCase().includes(search.toLowerCase())) || null
    : null;

  const relativeTime = useMemo(() => {
    if (!generatedAt) return null;
    const then = new Date(generatedAt).getTime();
    if (Number.isNaN(then)) return null;
    const diffMin = Math.floor((Date.now() - then) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    const h = Math.floor(diffMin / 60);
    if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
    return `${Math.floor(h / 24)} day${Math.floor(h / 24) > 1 ? "s" : ""} ago`;
  }, [generatedAt]);

  const mapHtml = geoData ? `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
      html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; }
      .legend { background: white; padding: 12px; line-height: 22px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.18); font-family: -apple-system, system-ui, sans-serif; font-size: 12px; max-width: 220px; }
      .legend-box { display: inline-block; width: 14px; height: 14px; margin-right: 6px; border: 1px solid #333; vertical-align: middle; border-radius: 3px; }
      .legend-section { margin-bottom: 8px; }
      .legend-title { font-weight: 800; color: #075f43; margin-bottom: 4px; }
      .leaflet-popup-content { font-family: -apple-system, system-ui, sans-serif; min-width: 200px; }
      .leaflet-popup-content strong { color: #075f43; font-size: 15px; }
      .station-popup .aqi-big { font-size: 32px; font-weight: 900; line-height: 1; }
      .station-popup .param-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; border-bottom: 1px solid #eee; }
      .tri-icon { background: #6b2e8c; color: white; border: 2px solid white; border-radius: 4px; font-size: 10px; font-weight: 900; width: 22px !important; height: 22px !important; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
      .superfund-icon { background: #c62828; color: white; border: 2px solid white; border-radius: 50%; font-size: 10px; font-weight: 900; width: 22px !important; height: 22px !important; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
      .my-pin { width: 28px; height: 38px; background: transparent; }
      .my-pin svg { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); }
    </style></head><body><div id="map"></div>
    <script>
      const geoData = ${JSON.stringify(geoData)};
      const stations = ${JSON.stringify(showAirnow ? airnowStations : [])};
      const triFacilities = ${JSON.stringify(showTri ? triFacilities : [])};
      const superfundSites = ${JSON.stringify(showSuperfund ? superfundSites : [])};
      const quintiles = ${JSON.stringify(quintiles)};
      const COLORS = ${JSON.stringify(RISK_COLORS)};
      const colorBy = ${JSON.stringify(colorBy)};
      const isReversed = ${JSON.stringify(isReversed)};
      const metricLabel = ${JSON.stringify(METRIC_LABELS[colorBy])};
      const basemap = ${JSON.stringify(basemap)};
      const pin = ${JSON.stringify(pin)};

      function getValue(p, keys, fb) { for (const k of keys) if (p[k] !== undefined && p[k] !== null && p[k] !== "") return p[k]; return fb; }
      function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
      function fmt(v, d) { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d || 1) : "N/A"; }
      function getCommunity(p) { return String(getValue(p, ["community","COMMUNITY"], "Unknown")); }
      function getDisplay(p) {
        const d = toNum(getValue(p, ["display_risk_score"], 0));
        if (d > 0) return d;
        const orig = toNum(getValue(p, ["new_risk_s","new_risk_score","risk_score","risk_scor","new_risk","risk"], 0)) || 0;
        const air = toNum(getValue(p, ["satellite_air_pollution_score"], 0)) || 0;
        const heat = toNum(getValue(p, ["heat_exposure_score"], 0)) || 0;
        const green = toNum(getValue(p, ["green_space_risk_score"], 0)) || 0;
        return orig * 0.7 + air * 0.1 + heat * 0.1 + green * 0.1;
      }
      function getMetric(p) {
        switch(colorBy) {
          case "risk": return getDisplay(p);
          case "poverty": return toNum(p.ph_below_poverty_level);
          case "income": return toNum(p.ph_per_capita_income);
          case "unemployment": return toNum(p.ph_unemployment);
          case "ses_vulnerability": return toNum(p.ph_ses_vulnerability_score);
        }
        return getDisplay(p);
      }
      function colorFor(score) {
        if (!Number.isFinite(score)) return "#cccccc";
        let bin = 0;
        if (score <= quintiles[0]) bin = 0;
        else if (score <= quintiles[1]) bin = 1;
        else if (score <= quintiles[2]) bin = 2;
        else if (score <= quintiles[3]) bin = 3;
        else bin = 4;
        if (isReversed) bin = 4 - bin;
        return [COLORS.veryLow, COLORS.low, COLORS.medium, COLORS.high, COLORS.veryHigh][bin];
      }
      function getRiskLevel(s) { return s >= 70 ? "High Risk" : s >= 40 ? "Medium Risk" : "Low Risk"; }

      const map = L.map("map").setView([41.8781, -87.6298], 11);
      const streetTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "© OpenStreetMap, © CartoDB", subdomains: "abcd", maxZoom: 20
      });
      const satelliteTiles = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Esri, Maxar, Earthstar Geographics", maxZoom: 19 }
      );
      (basemap === "satellite" ? satelliteTiles : streetTiles).addTo(map);
      const fillOpacity = basemap === "satellite" ? 0.55 : 0.74;

      const layer = L.geoJSON(geoData, {
        style: function(f) { return { fillColor: colorFor(getMetric(f.properties)), weight: 1, color: "#fff", fillOpacity }; },
        onEachFeature: function(f, layer) {
          const p = f.properties;
          const riskScore = getDisplay(p);
          const metricVal = getMetric(p);
          layer.on('mouseover', function(e) { e.target.setStyle({ weight: 3, color: "#075f43", fillOpacity: Math.min(fillOpacity + 0.15, 0.95) }); });
          layer.on('mouseout', function() { layer.setStyle({ weight: 1, color: "#fff", fillOpacity }); });
          const incomeStr = Number.isFinite(toNum(p.ph_per_capita_income)) ? "$" + Math.round(p.ph_per_capita_income).toLocaleString() : "N/A";
          layer.bindPopup(
            "<strong>" + getCommunity(p) + "</strong><br/>" +
            "<div style='margin:6px 0; font-size:24px; font-weight:800; color:" + colorFor(metricVal) + "'>" + fmt(metricVal) + "</div>" +
            "<div style='color:#666; margin-bottom:8px; font-size:11px; text-transform:uppercase; letter-spacing:0.5px'>" + metricLabel + "</div>" +
            "<hr style='border:none; border-top:1px solid #eee; margin:8px 0'/>" +
            "Risk Score: <strong>" + fmt(riskScore) + "</strong> (" + getRiskLevel(riskScore) + ")<br/>" +
            "Poverty: <strong>" + fmt(p.ph_below_poverty_level) + "%</strong><br/>" +
            "Per Capita Income: <strong>" + incomeStr + "</strong>"
          );
        }
      }).addTo(map);
      map.fitBounds(layer.getBounds());

      stations.forEach(function(s) {
        const marker = L.circleMarker([s.latitude, s.longitude], {
          radius: 11, fillColor: s.color, color: "#1a1a1a", weight: 2, opacity: 1, fillOpacity: 0.95,
        }).addTo(map);
        let paramRows = "";
        for (const [pname, r] of Object.entries(s.readings)) {
          paramRows += "<div class='param-row'><span>" + pname + "</span><span><strong>" + r.aqi.toFixed(0) + "</strong> AQI</span></div>";
        }
        marker.bindPopup(
          "<div class='station-popup'><strong>" + s.site_name + "</strong><br/>" +
          "<span style='color:#999; font-size:11px'>" + (s.agency || "EPA AirNow") + "</span>" +
          "<div class='aqi-big' style='color:" + s.color + "; margin:8px 0 2px 0'>" + s.worst_aqi.toFixed(0) + "</div>" +
          "<div style='font-weight:700; margin-bottom:8px'>" + s.category + "</div>" + paramRows + "</div>"
        );
      });

      triFacilities.forEach(function(f) {
        const icon = L.divIcon({ className: "tri-icon", html: "TRI", iconSize: [22, 22], iconAnchor: [11, 11] });
        L.marker([f.latitude, f.longitude], { icon: icon }).addTo(map).bindPopup(
          "<strong>" + f.name + "</strong><br/>" +
          "<div style='color:#999; font-size:11px; margin-top:2px'>EPA Toxic Release Inventory</div>" +
          "<div style='margin-top:8px; font-size:13px'>" + f.address + "<br/>" + f.city + ", IL " + f.zip + "</div>"
        );
      });

      superfundSites.forEach(function(s) {
        const icon = L.divIcon({ className: "superfund-icon", html: "☢", iconSize: [22, 22], iconAnchor: [11, 11] });
        L.marker([s.latitude, s.longitude], { icon: icon }).addTo(map).bindPopup(
          "<strong>" + s.name + "</strong><br/>" +
          "<div style='color:#c62828; font-size:11px; font-weight:800; margin-top:2px'>EPA Superfund Site</div>" +
          "<div style='margin-top:8px; font-size:13px'>Status: <strong>" + s.status + "</strong><br/>ZIP: " + s.zip + "</div>"
        );
      });

      if (pin) {
        const pinSvg = '<svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">' +
          '<path d="M14 0 C6 0 0 6 0 14 C0 23 14 38 14 38 C14 38 28 23 28 14 C28 6 22 0 14 0 Z" fill="#075f43"/>' +
          '<circle cx="14" cy="14" r="6" fill="white"/></svg>';
        const pinIcon = L.divIcon({ className: "my-pin", html: pinSvg, iconSize: [28, 38], iconAnchor: [14, 38] });
        const pinMarker = L.marker([pin.lat, pin.lng], { icon: pinIcon, zIndexOffset: 1000 }).addTo(map);
        pinMarker.bindPopup("<strong>" + pin.label + "</strong><br/><span style='font-size:11px; color:#666'>" + pin.lat.toFixed(4) + ", " + pin.lng.toFixed(4) + "</span>").openPopup();
        map.setView([pin.lat, pin.lng], 13);
      }

      const legend = L.control({ position: "bottomright" });
      legend.onAdd = function() {
        const div = L.DomUtil.create("div", "legend");
        let html = "<div class='legend-section'><div class='legend-title'>" + metricLabel + "</div>";
        const labels = isReversed ? ["Highest","High","Medium","Low","Lowest"] : ["Lowest","Low","Medium","High","Highest"];
        const colors = [COLORS.veryLow, COLORS.low, COLORS.medium, COLORS.high, COLORS.veryHigh];
        for (let i = 0; i < 5; i++) {
          html += "<span class='legend-box' style='background:" + colors[i] + "'></span> " + labels[i] + "<br/>";
        }
        html += "<span class='legend-box' style='background:#cccccc'></span> No data</div>";
        if (stations.length > 0) {
          html += "<div class='legend-section'><div class='legend-title'>EPA AQI</div>" +
            "<span class='legend-box' style='background:#00e400'></span> Good<br/>" +
            "<span class='legend-box' style='background:#ffff00'></span> Moderate<br/>" +
            "<span class='legend-box' style='background:#ff7e00'></span> Unhealthy SG</div>";
        }
        if (triFacilities.length > 0) {
          html += "<div class='legend-section'><span style='display:inline-block; background:#6b2e8c; color:white; padding:2px 5px; font-size:9px; border-radius:3px; margin-right:5px; font-weight:900'>TRI</span> Toxic-release facility</div>";
        }
        if (superfundSites.length > 0) {
          html += "<div class='legend-section'><span style='display:inline-block; background:#c62828; color:white; padding:2px 5px; font-size:9px; border-radius:50%; margin-right:5px; font-weight:900'>☢</span> Superfund site</div>";
        }
        div.innerHTML = html;
        return div;
      };
      legend.addTo(map);
    </script></body></html>
  ` : "";

  const statusColor = dataStatus === "live" ? "#2e7d32" : dataStatus === "backup" ? "#f59e0b" : dataStatus === "error" ? "#c62828" : "#6b7280";
  const weatherBg = weather?.current?.is_day === false ? "#0f172a" : "#075f43";

  return (
    <ScrollView style={sharedStyles.page}>
      <View style={sharedStyles.hero}>
        <Text style={sharedStyles.heroTitle}>EnviroSight Chicago</Text>
        <Text style={sharedStyles.heroSubtitle}>Environmental Risk + Health + Equity</Text>
        <Text style={sharedStyles.heroDescription}>
          Find your address's environmental risk. Satellite, EPA sensors, Superfund sites,
          public health data, and live weather across all 77 Chicago community areas.
        </Text>
      </View>

      <View style={[styles.liveBanner, { borderLeftColor: statusColor }]}>
        <View style={styles.liveBannerRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.liveBannerTitle}>
            {dataStatus === "live" && "Live data"}
            {dataStatus === "backup" && "Saved data"}
            {dataStatus === "loading" && "Loading..."}
            {dataStatus === "error" && "Data unavailable"}
          </Text>
        </View>
        <Text style={styles.liveBannerSubtext}>
          {dataStatus === "live" && relativeTime ? `Updated ${relativeTime} · ${dataSource}` : dataSource}
        </Text>
      </View>

      {weather?.alerts && weather.alerts.length > 0 && (
        <View style={styles.alertsCard}>
          {weather.alerts.map((alert) => (
            <View key={alert.id} style={[
              styles.alertItem,
              { borderLeftColor: alert.severity === "Extreme" || alert.severity === "Severe" ? "#c62828" : "#f59e0b" }
            ]}>
              <Text style={styles.alertEvent}>⚠ {alert.event}</Text>
              <Text style={styles.alertHeadline}>{alert.headline}</Text>
              {alert.instruction && <Text style={styles.alertInstruction}>{alert.instruction}</Text>}
              <Text style={styles.alertMeta}>
                {alert.severity} · {alert.urgency} · {alert.sender_name}
              </Text>
            </View>
          ))}
        </View>
      )}

      {weather?.available && weather.current && (
        <View style={[styles.weatherCard, { backgroundColor: weatherBg }]}>
          <View style={styles.weatherHeaderRow}>
            <Text style={styles.weatherLocation}>{weather.location || "Chicago, IL"}</Text>
            <Text style={styles.weatherSource}>Open-Meteo · Updates every 10 min</Text>
          </View>
          <View style={styles.weatherMainRow}>
            {Platform.OS === "web"
              ? React.createElement("img", {
                  src: meteoconUrl(weather.current.weather.code, weather.current.is_day),
                  alt: weather.current.weather.label,
                  style: { width: 140, height: 140, marginRight: 8 },
                })
              : <Text style={styles.weatherEmoji}>{weather.current.weather.emoji}</Text>
            }
            <View style={styles.weatherMainText}>
              <Text style={styles.weatherTemp}>{Math.round(weather.current.temperature_f)}°F</Text>
              <Text style={styles.weatherCondition}>{weather.current.weather.label}</Text>
              <Text style={styles.weatherFeels}>Feels like {Math.round(weather.current.feels_like_f)}°F</Text>
            </View>
          </View>
          <View style={styles.weatherStatsRow}>
            <WeatherStat label="Humidity" value={`${weather.current.humidity_pct}%`} />
            <WeatherStat label="Wind" value={`${Math.round(weather.current.wind_speed_mph)} mph ${windDirectionLabel(weather.current.wind_direction_deg)}`} />
            <WeatherStat label="UV Index" value={weather.current.uv_index?.toFixed(1) || "—"} />
            <WeatherStat label="Precip" value={`${weather.current.precipitation_in?.toFixed(2) || "0.00"}″`} />
          </View>
          {weather.daily && weather.daily.length > 0 && (
            <>
              <Text style={styles.weatherForecastLabel}>7-DAY FORECAST</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.forecastScroll}>
                {weather.daily.map((d, i) => (
                  <View key={d.date} style={styles.forecastDay}>
                    <Text style={styles.forecastDayName}>{i === 0 ? "Today" : shortDayName(d.date)}</Text>
                    {Platform.OS === "web"
                      ? React.createElement("img", {
                          src: meteoconUrl(d.weather.code, true),
                          alt: d.weather.label,
                          style: { width: 56, height: 56 },
                        })
                      : <Text style={styles.forecastEmoji}>{d.weather.emoji}</Text>
                    }
                    <Text style={styles.forecastTempHigh}>{Math.round(d.temp_max_f)}°</Text>
                    <Text style={styles.forecastTempLow}>{Math.round(d.temp_min_f)}°</Text>
                    {d.precip_prob_pct > 0 && (
                      <Text style={styles.forecastPrecip}>💧 {d.precip_prob_pct}%</Text>
                    )}
                  </View>
                ))}
              </ScrollView>
              {weather.daily[0]?.sunrise && (
                <View style={styles.sunRow}>
                  <Text style={styles.sunText}>🌅 Sunrise {formatHour(weather.daily[0].sunrise)}</Text>
                  <Text style={styles.sunText}>🌇 Sunset {formatHour(weather.daily[0].sunset)}</Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Find Your Address</Text>
        <Text style={sharedStyles.cardSubtitle}>
          Enter a Chicago address or use your device's location to see your neighborhood's environmental risk.
        </Text>
        <View style={styles.addressInputRow}>
          <TextInput
            style={styles.addressInput}
            placeholder="e.g. 1060 W Addison St"
            placeholderTextColor="#9ca3af"
            value={addressQuery}
            onChangeText={setAddressQuery}
            onSubmitEditing={geocodeAddress}
            returnKeyType="search"
          />
          <Pressable onPress={geocodeAddress} style={styles.addressSearchButton} disabled={geocoding}>
            {geocoding ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.addressSearchButtonText}>Search</Text>}
          </Pressable>
        </View>
        <View style={styles.addressActionRow}>
          <Pressable onPress={useMyLocation} style={styles.locationButton} disabled={locating}>
            {locating ? <ActivityIndicator color="#075f43" size="small" /> : <Text style={styles.locationButtonText}>📍 Use my location</Text>}
          </Pressable>
          {pin && (
            <Pressable onPress={clearPin} style={styles.clearButton}>
              <Text style={styles.clearButtonText}>Clear pin</Text>
            </Pressable>
          )}
        </View>
        {geocodeError && <Text style={styles.errorText}>{geocodeError}</Text>}
        {pin && pinMatchedFeature && (
          <View style={styles.pinResult}>
            <Text style={styles.pinResultLabel}>📍 {pin.label}</Text>
            <Text style={styles.pinResultName}>{getCommunity(pinMatchedFeature)}</Text>
            <View style={styles.scoreRow}>
              <Text style={[styles.bigScore, { color: getMetricColor(getDisplayRiskScore(pinMatchedFeature)) }]}>
                {formatNumber(getDisplayRiskScore(pinMatchedFeature))}
              </Text>
              <View style={[styles.riskPill, { backgroundColor: getMetricColor(getDisplayRiskScore(pinMatchedFeature)) }]}>
                <Text style={styles.riskPillText}>{getRiskLevel(getDisplayRiskScore(pinMatchedFeature))}</Text>
              </View>
            </View>
            <Text style={styles.explainText}>{explain(pinMatchedFeature)}</Text>
            <View style={styles.pinQuickStats}>
              <QuickStat label="Air Pollution" value={getSatelliteAirPollutionScore(pinMatchedFeature).toFixed(1)} />
              <QuickStat label="Heat" value={getHeatRisk(pinMatchedFeature).toFixed(1)} />
              <QuickStat label="Green Space" value={getGreenRisk(pinMatchedFeature).toFixed(1)} />
              {Number.isFinite(getPoverty(pinMatchedFeature)) && <QuickStat label="Poverty %" value={`${getPoverty(pinMatchedFeature).toFixed(1)}%`} />}
            </View>
          </View>
        )}
        {pin && !pinMatchedFeature && (
          <View style={styles.pinResult}>
            <Text style={styles.pinResultLabel}>📍 {pin.label}</Text>
            <Text style={sharedStyles.bodyText}>This location is outside Chicago's 77 community areas.</Text>
          </View>
        )}
      </View>

      <TextInput
        style={styles.search}
        placeholder="Or search a community area, e.g. Englewood"
        placeholderTextColor="#9ca3af"
        value={search}
        onChangeText={setSearch}
      />

      {search.length > 0 && selected && (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>{getCommunity(selected)}</Text>
          <View style={styles.scoreRow}>
            <Text style={[styles.bigScore, { color: getMetricColor(getDisplayRiskScore(selected)) }]}>
              {formatNumber(getDisplayRiskScore(selected))}
            </Text>
            <View style={[styles.riskPill, { backgroundColor: getMetricColor(getDisplayRiskScore(selected)) }]}>
              <Text style={styles.riskPillText}>{getRiskLevel(getDisplayRiskScore(selected))}</Text>
            </View>
          </View>
          <View style={styles.explainBox}>
            <Text style={styles.explainText}>{explain(selected)}</Text>
          </View>
          <Text style={styles.sectionTitle}>Environmental Indicators</Text>
          <ScoreBar label="Satellite Air Pollution" value={getSatelliteAirPollutionScore(selected)} />
          <ScoreBar label="Heat Exposure" value={getHeatRisk(selected)} />
          <ScoreBar label="Green Space Risk" value={getGreenRisk(selected)} />
          <Text style={styles.sectionTitle}>Health & Socioeconomic</Text>
          {Number.isFinite(getPoverty(selected)) ? (
            <>
              <InfoRow label="Below Poverty Level" value={`${getPoverty(selected).toFixed(1)}%`} />
              <InfoRow label="Unemployment" value={`${getUnemployment(selected).toFixed(1)}%`} />
              <InfoRow label="No High School Diploma" value={`${getNoHsDiploma(selected).toFixed(1)}%`} />
              <InfoRow label="Per Capita Income" value={`$${Math.round(getIncome(selected)).toLocaleString()}`} />
              <InfoRow label="Crowded Housing" value={`${getCrowdedHousing(selected).toFixed(1)}%`} />
              {Number.isFinite(getSesVulnerability(selected)) && (
                <View style={{ marginTop: 8 }}>
                  <ScoreBar label="Composite SES Vulnerability" value={getSesVulnerability(selected)} />
                </View>
              )}
            </>
          ) : (
            <Text style={sharedStyles.bodyText}>No public health data matched for this area.</Text>
          )}
          <Text style={styles.sectionTitle}>Public Health Indicators (Chicago Health Atlas)</Text>
          {Number.isFinite(toNumber(getValue(selected, ["ph_infant_mortality_rate"], NaN))) && (
            <InfoRow label="Infant Mortality Rate" value={`${toNumber(getValue(selected, ["ph_infant_mortality_rate"], 0)).toFixed(1)} per 1,000`} />
          )}
          {Number.isFinite(toNumber(getValue(selected, ["ph_low_birth_weight"], NaN))) && (
            <InfoRow label="Low Birth Weight" value={`${toNumber(getValue(selected, ["ph_low_birth_weight"], 0)).toFixed(1)}%`} />
          )}
          {Number.isFinite(toNumber(getValue(selected, ["ph_diabetes_related"], NaN))) && (
            <InfoRow label="Diabetes-Related Deaths" value={`${toNumber(getValue(selected, ["ph_diabetes_related"], 0)).toFixed(1)} per 100k`} />
          )}
          {Number.isFinite(toNumber(getValue(selected, ["ph_lung_cancer"], NaN))) && (
            <InfoRow label="Lung Cancer Deaths" value={`${toNumber(getValue(selected, ["ph_lung_cancer"], 0)).toFixed(1)} per 100k`} />
          )}
          {Number.isFinite(toNumber(getValue(selected, ["ph_childhood_lead_poisoning"], NaN))) && (
            <InfoRow label="Childhood Lead Poisoning" value={`${toNumber(getValue(selected, ["ph_childhood_lead_poisoning"], 0)).toFixed(1)}%`} />
          )}

          <Text style={styles.sectionTitle}>Pollutant Breakdown</Text>
          <ScoreBar label="NO₂" value={toNumber(getValue(selected, ["no2_pollution_score"], 0))} />
          <ScoreBar label="PM2.5 Proxy (AOD)" value={toNumber(getValue(selected, ["pm25_proxy_pollution_score"], 0))} />
          <ScoreBar label="SO₂" value={toNumber(getValue(selected, ["so2_pollution_score"], 0))} />
          <ScoreBar label="CO" value={toNumber(getValue(selected, ["co_pollution_score"], 0))} />
          <ScoreBar label="O₃" value={toNumber(getValue(selected, ["o3_pollution_score"], 0))} />
        </View>
      )}

      {search.length > 0 && !selected && (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>Not found</Text>
          <Text style={sharedStyles.bodyText}>"{search}" doesn't match any Chicago community area.</Text>
        </View>
      )}

      <View style={styles.mapCard}>
        <View style={styles.mapHeader}>
          <Text style={sharedStyles.cardTitle}>Map · {METRIC_LABELS[colorBy]}</Text>
          <View style={styles.toggleGroup}>
            <Pressable onPress={() => setBasemap(basemap === "street" ? "satellite" : "street")} style={styles.basemapToggle}>
              <Text style={styles.basemapToggleText}>{basemap === "street" ? "🛰  Satellite" : "🗺  Street"}</Text>
            </Pressable>
            {airnowStations.length > 0 && (
              <Pressable onPress={() => setShowAirnow(!showAirnow)} style={[styles.toggleButton, showAirnow && styles.toggleButtonActive]}>
                <Text style={[styles.toggleButtonText, showAirnow && styles.toggleButtonTextActive]}>AQI ({airnowStations.length})</Text>
              </Pressable>
            )}
            {triFacilities.length > 0 && (
              <Pressable onPress={() => setShowTri(!showTri)} style={[styles.toggleButton, showTri && styles.toggleButtonActiveTri]}>
                <Text style={[styles.toggleButtonText, showTri && styles.toggleButtonTextActive]}>TRI ({triFacilities.length})</Text>
              </Pressable>
            )}
            {superfundSites.length > 0 && (
              <Pressable onPress={() => setShowSuperfund(!showSuperfund)} style={[styles.toggleButton, showSuperfund && styles.toggleButtonActiveSuperfund]}>
                <Text style={[styles.toggleButtonText, showSuperfund && styles.toggleButtonTextActive]}>☢ Superfund ({superfundSites.length})</Text>
              </Pressable>
            )}
          </View>
        </View>
        <Text style={styles.metricLabel}>COLOR MAP BY:</Text>
        <View style={styles.colorByRow}>
          {(["risk", "poverty", "income", "unemployment", "ses_vulnerability"] as ColorByMetric[]).map((m) => (
            <Pressable key={m} onPress={() => setColorBy(m)} style={[styles.colorByButton, colorBy === m && styles.colorByButtonActive]}>
              <Text style={[styles.colorByButtonText, colorBy === m && styles.colorByButtonTextActive]}>{METRIC_LABELS[m]}</Text>
            </Pressable>
          ))}
        </View>
        {Platform.OS === "web" && geoData ? (
          React.createElement("iframe", {
            srcDoc: mapHtml,
            title: "Chicago Risk Map",
            style: { width: "100%", height: 700, border: "none", borderRadius: 12 },
          })
        ) : (
          <Text style={sharedStyles.bodyText}>Map only available on web.</Text>
        )}
      </View>

      <Text style={sharedStyles.footer}>
        EnviroSight Chicago · Satellite · EPA · Chicago Data Portal · Open-Meteo · OpenStreetMap
      </Text>
      <Text style={sharedStyles.copyright}>
        © {new Date().getFullYear()} EnviroSight Chicago. All rights reserved.
      </Text>
    </ScrollView>
  );
}

function WeatherStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.weatherStat}>
      <Text style={styles.weatherStatLabel}>{label}</Text>
      <Text style={styles.weatherStatValue}>{value}</Text>
    </View>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const safe = Math.max(0, Math.min(100, value));
  const color = safe >= 70 ? "#c62828" : safe >= 40 ? "#fb8c00" : safe >= 20 ? "#fdd835" : "#9ccc65";
  return (
    <View style={styles.scoreBarWrapper}>
      <View style={styles.scoreBarHeader}>
        <Text style={styles.scoreBarLabel}>{label}</Text>
        <Text style={[styles.scoreBarValue, { color }]}>{safe.toFixed(1)}</Text>
      </View>
      <View style={styles.scoreBarTrack}>
        <View style={[styles.scoreBarFill, { width: `${safe}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.quickStat}>
      <Text style={styles.quickStatLabel}>{label}</Text>
      <Text style={styles.quickStatValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  liveBanner: { backgroundColor: "white", margin: 20, marginBottom: 0, padding: 16, borderRadius: 14, borderLeftWidth: 4 },
  liveBannerRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  liveBannerTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  liveBannerSubtext: { fontSize: 13, color: "#6b7280", marginLeft: 20 },

  alertsCard: { margin: 20, marginBottom: 0, gap: 10 },
  alertItem: { backgroundColor: "#fff7ed", padding: 14, borderRadius: 10, borderLeftWidth: 4 },
  alertEvent: { fontSize: 13, fontWeight: "900", color: "#9a3412", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  alertHeadline: { fontSize: 14, fontWeight: "800", color: "#111827", marginBottom: 6, lineHeight: 19 },
  alertInstruction: { fontSize: 13, color: "#374151", marginBottom: 6, lineHeight: 18 },
  alertMeta: { fontSize: 11, color: "#9a3412", fontWeight: "700" },
  weatherCard: { margin: 20, marginBottom: 0, padding: 18, borderRadius: 14 },
  weatherHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  weatherLocation: { color: "white", fontSize: 15, fontWeight: "800" },
  weatherSource: { color: "rgba(255,255,255,0.6)", fontSize: 11 },
  weatherMainRow: { flexDirection: "row", alignItems: "center", marginTop: 6, marginBottom: 4 },
  weatherEmoji: { fontSize: 80, marginRight: 12 },
  weatherMainText: { flex: 1 },
  weatherTemp: { color: "white", fontSize: 48, fontWeight: "900", lineHeight: 54 },
  weatherCondition: { color: "white", fontSize: 18, fontWeight: "700" },
  weatherFeels: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 2 },
  weatherStatsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  weatherStat: { flex: 1, minWidth: 90, backgroundColor: "rgba(255,255,255,0.12)", padding: 10, borderRadius: 8 },
  weatherStatLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  weatherStatValue: { color: "white", fontSize: 15, fontWeight: "800", marginTop: 4 },
  weatherForecastLabel: { color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 18, marginBottom: 6 },
  forecastScroll: { marginBottom: 8 },
  forecastDay: { backgroundColor: "rgba(255,255,255,0.10)", padding: 10, borderRadius: 12, marginRight: 8, minWidth: 78, alignItems: "center" },
  forecastDayName: { color: "white", fontWeight: "800", fontSize: 12 },
  forecastEmoji: { fontSize: 36, marginVertical: 4 },
  forecastTempHigh: { color: "white", fontWeight: "900", fontSize: 16 },
  forecastTempLow: { color: "rgba(255,255,255,0.6)", fontWeight: "700", fontSize: 13 },
  forecastPrecip: { color: "#7dd3fc", fontSize: 10, fontWeight: "700", marginTop: 2 },
  sunRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.15)" },
  sunText: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "600" },

  search: { margin: 20, marginTop: 16, marginBottom: 0, padding: 14, borderRadius: 12, backgroundColor: "white", borderWidth: 1, borderColor: "#e5e7eb", fontSize: 14 },

  addressInputRow: { flexDirection: "row", gap: 8 },
  addressInput: { flex: 1, padding: 12, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, backgroundColor: "#f9fafb", fontSize: 14 },
  addressSearchButton: { backgroundColor: "#075f43", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", minWidth: 80 },
  addressSearchButtonText: { color: "white", fontWeight: "800", fontSize: 14 },
  addressActionRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  locationButton: { flex: 1, backgroundColor: "#eef8f2", paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: "#075f43" },
  locationButtonText: { color: "#075f43", fontWeight: "800", fontSize: 13 },
  clearButton: { backgroundColor: "#f3f4f6", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  clearButtonText: { color: "#6b7280", fontWeight: "700", fontSize: 13 },
  errorText: { color: "#c62828", fontSize: 13, marginTop: 8, fontWeight: "700" },

  pinResult: { marginTop: 16, padding: 14, backgroundColor: "#eef8f2", borderRadius: 10, borderLeftWidth: 4, borderLeftColor: "#075f43" },
  pinResultLabel: { fontWeight: "800", color: "#075f43", fontSize: 13, marginBottom: 4 },
  pinResultName: { fontSize: 20, fontWeight: "900", color: "#111827", marginBottom: 8 },
  pinQuickStats: { flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" },
  quickStat: { flex: 1, minWidth: 90, backgroundColor: "white", padding: 8, borderRadius: 8 },
  quickStatLabel: { fontSize: 10, fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 },
  quickStatValue: { fontSize: 14, fontWeight: "900", color: "#111827", marginTop: 2 },

  scoreRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  bigScore: { fontSize: 36, fontWeight: "900" },
  riskPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  riskPillText: { color: "white", fontWeight: "800", fontSize: 12 },
  explainBox: { backgroundColor: "#f9fafb", padding: 12, borderRadius: 10, marginBottom: 14 },
  explainText: { color: "#374151", fontSize: 13, lineHeight: 19 },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },

  scoreBarWrapper: { marginTop: 8 },
  scoreBarHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  scoreBarLabel: { fontWeight: "700", color: "#374151", fontSize: 13 },
  scoreBarValue: { fontWeight: "900", fontSize: 13 },
  scoreBarTrack: { height: 10, backgroundColor: "#f3f4f6", borderRadius: 999, overflow: "hidden" },
  scoreBarFill: { height: "100%", borderRadius: 999 },

  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  infoLabel: { fontWeight: "600", color: "#6b7280", fontSize: 13 },
  infoValue: { fontWeight: "800", color: "#111827", fontSize: 13 },

  mapCard: { backgroundColor: "white", margin: 20, marginBottom: 0, padding: 16, borderRadius: 14 },
  mapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" },
  metricLabel: { fontSize: 10, fontWeight: "800", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  colorByRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  colorByButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "#f3f4f6" },
  colorByButtonActive: { backgroundColor: "#075f43" },
  colorByButtonText: { color: "#374151", fontWeight: "700", fontSize: 12 },
  colorByButtonTextActive: { color: "white" },

  toggleGroup: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  basemapToggle: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: "#075f43", backgroundColor: "white" },
  basemapToggleText: { color: "#075f43", fontWeight: "800", fontSize: 12 },
  toggleButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: "#075f43", backgroundColor: "white" },
  toggleButtonActive: { backgroundColor: "#075f43", borderColor: "#075f43" },
  toggleButtonActiveTri: { backgroundColor: "#6b2e8c", borderColor: "#6b2e8c" },
  toggleButtonActiveSuperfund: { backgroundColor: "#c62828", borderColor: "#c62828" },
  toggleButtonText: { color: "#075f43", fontWeight: "800", fontSize: 12 },
  toggleButtonTextActive: { color: "white" },
});

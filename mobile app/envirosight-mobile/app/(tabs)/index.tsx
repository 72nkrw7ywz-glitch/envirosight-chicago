import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, ScrollView, StyleSheet, Platform, Pressable, ActivityIndicator,
} from "react-native";

type FeatureProperties = { community?: string; COMMUNITY?: string; [key: string]: any };
type GeoJsonFeature = { type: string; properties: FeatureProperties; geometry: any };
type RiskFilter = "All" | "Low Risk" | "Medium Risk" | "High Risk";
type ColorByMetric = "risk" | "poverty" | "income" | "unemployment" | "ses_vulnerability";
type BasemapType = "street" | "satellite";

type AirNowStation = {
  latitude: number; longitude: number; site_name: string; agency: string;
  worst_aqi: number; worst_parameter: string; color: string; category: string;
  readings: Record<string, { aqi: number; value: number; unit: string; utc: string }>;
};
type AirNowSummary = {
  available: boolean; worst_aqi?: number; worst_category?: string; worst_color?: string;
  observed_at?: string; reporting_area?: string;
  by_parameter?: Record<string, { aqi: number; category: string }>;
};
type TriFacility = {
  id: string; name: string; address: string; city: string; zip: string;
  industry: string; latitude: number; longitude: number;
};
type Pin = { lat: number; lng: number; label: string };

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
type WeatherData = {
  available: boolean; current?: WeatherCurrent; daily?: WeatherDay[]; location?: string;
};

const RISK_COLORS = {
  veryLow: "#2e7d32", low: "#9ccc65", medium: "#fdd835",
  high: "#fb8c00", veryHigh: "#c62828",
};

const API_BASE = "http://127.0.0.1:8000";

const METRIC_LABELS: Record<ColorByMetric, string> = {
  risk: "Environmental Risk",
  poverty: "Poverty Rate",
  income: "Income (lower = darker)",
  unemployment: "Unemployment Rate",
  ses_vulnerability: "Socioeconomic Vulnerability",
};

// Compass direction from degrees
function windDirectionLabel(deg: number): string {
  if (!Number.isFinite(deg)) return "—";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function formatHour(isoTime: string): string {
  if (!isoTime) return "—";
  try {
    const d = new Date(isoTime);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch { return "—"; }
}

function shortDayName(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString([], { weekday: "short" });
  } catch { return "—"; }
}

// Point-in-polygon
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

export default function HomeScreen() {
  const [geoData, setGeoData] = useState<any>(null);
  const [airnowStations, setAirnowStations] = useState<AirNowStation[]>([]);
  const [airnowSummary, setAirnowSummary] = useState<AirNowSummary | null>(null);
  const [triFacilities, setTriFacilities] = useState<TriFacility[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);

  const [showAirnow, setShowAirnow] = useState(true);
  const [showTri, setShowTri] = useState(true);
  const [colorBy, setColorBy] = useState<ColorByMetric>("risk");
  const [basemap, setBasemap] = useState<BasemapType>("street");

  const [addressQuery, setAddressQuery] = useState("");
  const [pin, setPin] = useState<Pin | null>(null);
  const [pinMatchedFeature, setPinMatchedFeature] = useState<FeatureProperties | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("All");
  const [dataSource, setDataSource] = useState("Loading...");
  const [dataStatus, setDataStatus] = useState<"loading" | "live" | "backup" | "error">("loading");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [showCompare, setShowCompare] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);

  useEffect(() => {
    (async function loadRiskMap() {
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
    (async function loadExtras() {
      try {
        const [s, sum, tri, w] = await Promise.all([
          fetch(`${API_BASE}/api/airnow-stations`),
          fetch(`${API_BASE}/api/airnow-summary`),
          fetch(`${API_BASE}/api/tri-facilities`),
          fetch(`${API_BASE}/api/weather`),
        ]);
        if (s.ok) {
          const d = await s.json();
          if (d.available && Array.isArray(d.stations)) setAirnowStations(d.stations);
        }
        if (sum.ok) setAirnowSummary(await sum.json());
        if (tri.ok) {
          const d = await tri.json();
          if (d.available && Array.isArray(d.facilities)) setTriFacilities(d.facilities);
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

  const getValue = (p: any, keys: string[], fb: any = "N/A") => {
    for (const k of keys) if (p && p[k] !== undefined && p[k] !== null && p[k] !== "") return p[k];
    return fb;
  };
  const toNumber = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const formatNumber = (v: any, d = 1) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : "N/A"; };
  const getCommunity = (p: any) => String(getValue(p, ["community", "COMMUNITY", "community_area", "community_n", "name"], "Unknown"));
  const getOriginalRiskScore = (p: any) => toNumber(getValue(p, ["new_risk_s", "new_risk_score", "risk_score", "risk_scor", "new_risk", "risk"], 0));
  const getSatelliteAirPollutionScore = (p: any) => toNumber(getValue(p, ["satellite_air_pollution_score"], 0));
  const getHeatRisk = (p: any) => toNumber(getValue(p, ["heat_exposure_score"], 0));
  const getGreenRisk = (p: any) => toNumber(getValue(p, ["green_space_risk_score"], 0));
  const getDisplayRiskScore = (p: any) => {
    const d = toNumber(getValue(p, ["display_risk_score"], 0));
    if (d > 0) return d;
    return getOriginalRiskScore(p) * 0.7 + getSatelliteAirPollutionScore(p) * 0.1 + getHeatRisk(p) * 0.1 + getGreenRisk(p) * 0.1;
  };
  const getRiskLevel = (s: number) => s >= 70 ? "High Risk" : s >= 40 ? "Medium Risk" : "Low Risk";
  const getPoverty = (p: any) => toNumber(getValue(p, ["ph_below_poverty_level"], NaN));
  const getUnemployment = (p: any) => toNumber(getValue(p, ["ph_unemployment"], NaN));
  const getNoHsDiploma = (p: any) => toNumber(getValue(p, ["ph_no_high_school_diploma"], NaN));
  const getIncome = (p: any) => toNumber(getValue(p, ["ph_per_capita_income"], NaN));
  const getCrowdedHousing = (p: any) => toNumber(getValue(p, ["ph_crowded_housing"], NaN));
  const getSesVulnerability = (p: any) => toNumber(getValue(p, ["ph_ses_vulnerability_score"], NaN));

  const getMetricValue = (p: any, metric: ColorByMetric): number => {
    switch (metric) {
      case "risk": return getDisplayRiskScore(p);
      case "poverty": return getPoverty(p);
      case "income": return getIncome(p);
      case "unemployment": return getUnemployment(p);
      case "ses_vulnerability": return getSesVulnerability(p);
    }
  };

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
  const ranked = useMemo(() => [...allNeighborhoods].sort((a, b) => getDisplayRiskScore(b) - getDisplayRiskScore(a)), [geoData]);

  const quintiles = useMemo(() => {
    if (ranked.length === 0) return [0, 0, 0, 0];
    const values = ranked.map((p) => getMetricValue(p, colorBy)).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length === 0) return [0, 0, 0, 0];
    return [0.2, 0.4, 0.6, 0.8].map((p) => values[Math.floor(values.length * p)]);
  }, [ranked, colorBy]);

  const isReversed = colorBy === "income";

  const getMetricColor = (score: number): string => {
    if (!Number.isFinite(score)) return "#cccccc";
    let bin = 0;
    if (score <= quintiles[0]) bin = 0;
    else if (score <= quintiles[1]) bin = 1;
    else if (score <= quintiles[2]) bin = 2;
    else if (score <= quintiles[3]) bin = 3;
    else bin = 4;
    if (isReversed) bin = 4 - bin;
    return [RISK_COLORS.veryLow, RISK_COLORS.low, RISK_COLORS.medium, RISK_COLORS.high, RISK_COLORS.veryHigh][bin];
  };

  const filtered = useMemo(() => {
    if (riskFilter === "All") return ranked;
    return ranked.filter((item) => getRiskLevel(getDisplayRiskScore(item)) === riskFilter);
  }, [ranked, riskFilter]);

  const selected = search.length > 0
    ? allNeighborhoods.find((item) => getCommunity(item).toLowerCase().includes(search.toLowerCase())) || null
    : null;

  const totalAreas = ranked.length;
  const avgRisk = totalAreas > 0 ? ranked.reduce((s, i) => s + getDisplayRiskScore(i), 0) / totalAreas : 0;
  const highest = ranked[0];
  const highRiskCount = ranked.filter((i) => getRiskLevel(getDisplayRiskScore(i)) === "High Risk").length;

  const medianPoverty = useMemo(() => {
    const vals = ranked.map(getPoverty).filter(Number.isFinite).sort((a, b) => a - b);
    if (vals.length === 0) return null;
    return vals[Math.floor(vals.length / 2)];
  }, [ranked]);

  const top10 = ranked.slice(0, 10);
  const top10Max = top10[0] ? getDisplayRiskScore(top10[0]) : 100;
  const areaA = allNeighborhoods.find((n) => getCommunity(n).toLowerCase() === compareA.toLowerCase());
  const areaB = allNeighborhoods.find((n) => getCommunity(n).toLowerCase() === compareB.toLowerCase());

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
      .my-pin { width: 28px; height: 38px; background: transparent; }
      .my-pin svg { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); }
    </style></head><body><div id="map"></div>
    <script>
      const geoData = ${JSON.stringify(geoData)};
      const stations = ${JSON.stringify(showAirnow ? airnowStations : [])};
      const triFacilities = ${JSON.stringify(showTri ? triFacilities : [])};
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
      function getCommunity(p) { return String(getValue(p, ["community", "COMMUNITY"], "Unknown")); }
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
          html += "<div class='legend-section'><span style='display:inline-block; background:#6b2e8c; color:white; padding:2px 5px; font-size:9px; border-radius:3px; margin-right:5px; font-weight:900'>TRI</span> Toxic-release</div>";
        }
        div.innerHTML = html;
        return div;
      };
      legend.addTo(map);
    </script></body></html>
  ` : "";

  const statusColor = dataStatus === "live" ? "#2e7d32" : dataStatus === "backup" ? "#f59e0b" : dataStatus === "error" ? "#c62828" : "#6b7280";

  // Weather card background tint based on temperature/conditions
  const weatherBg = weather?.current?.is_day === false ? "#0f172a" : "#075f43";

  // Meteocons: photorealistic, animated SVG weather icons (free, MIT licensed)
  // Bas Milius — https://bas.dev/work/meteocons
  const meteoconUrl = (code: number, isDay: boolean = true): string => {
    const base = "https://cdn.jsdelivr.net/gh/basmilius/weather-icons/production/fill/all";
    const dn = isDay ? "day" : "night";
    const map: Record<number, string> = {
      0: `clear-${dn}`,
      1: `clear-${dn}`,
      2: `partly-cloudy-${dn}`,
      3: `overcast-${dn}`,
      45: `fog-${dn}`,
      48: `fog-${dn}`,
      51: "drizzle",
      53: "drizzle",
      55: "drizzle",
      56: "sleet",
      57: "sleet",
      61: "rain",
      63: "rain",
      65: "rain",
      66: "sleet",
      67: "sleet",
      71: "snow",
      73: "snow",
      75: "snow",
      77: "snow",
      80: `partly-cloudy-${dn}-rain`,
      81: "rain",
      82: "thunderstorms-rain",
      85: `partly-cloudy-${dn}-snow`,
      86: "snow",
      95: "thunderstorms",
      96: "thunderstorms-rain",
      99: "thunderstorms-rain",
    };
    const icon = map[code] ?? `clear-${dn}`;
    return `${base}/${icon}.svg`;
  };

  return (
    <ScrollView style={styles.page}>
      <View style={styles.hero}>
        <Text style={styles.title}>EnviroSight Chicago</Text>
        <Text style={styles.subtitle}>Environmental Risk + Health + Equity</Text>
        <Text style={styles.description}>
          Find your address's environmental risk. Satellite data, EPA ground sensors, toxic-release facilities,
          public health statistics, and live weather across all 77 Chicago community areas.
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

      {/* WEATHER CARD */}
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
              <Text style={styles.weatherFeels}>
                Feels like {Math.round(weather.current.feels_like_f)}°F
              </Text>
            </View>
          </View>

          <View style={styles.weatherStatsRow}>
            <WeatherStat label="Humidity" value={`${weather.current.humidity_pct}%`} />
            <WeatherStat
              label="Wind"
              value={`${Math.round(weather.current.wind_speed_mph)} mph ${windDirectionLabel(weather.current.wind_direction_deg)}`}
            />
            <WeatherStat label="UV Index" value={weather.current.uv_index?.toFixed(1) || "—"} />
            <WeatherStat
              label="Precip"
              value={`${weather.current.precipitation_in?.toFixed(2) || "0.00"}″`}
            />
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

      {airnowSummary?.available && (
        <View style={[styles.aqiBanner, { borderLeftColor: airnowSummary.worst_color }]}>
          <View style={styles.aqiHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.aqiLabel}>LIVE EPA AIR QUALITY · {airnowSummary.reporting_area?.toUpperCase()}</Text>
              <Text style={[styles.aqiValue, { color: airnowSummary.worst_color }]}>{airnowSummary.worst_aqi} AQI</Text>
              <Text style={styles.aqiCategory}>{airnowSummary.worst_category}</Text>
            </View>
            <View style={styles.aqiParams}>
              {airnowSummary.by_parameter && Object.entries(airnowSummary.by_parameter).map(([param, data]) => (
                <View key={param} style={styles.aqiParamRow}>
                  <Text style={styles.aqiParamName}>{param}</Text>
                  <Text style={styles.aqiParamValue}>{data.aqi}</Text>
                </View>
              ))}
            </View>
          </View>
          <Text style={styles.aqiTimestamp}>Observed {airnowSummary.observed_at}</Text>
        </View>
      )}

      <View style={styles.kpiGrid}>
        <KpiCard title="Community Areas" value={totalAreas.toString()} accent="#075f43" />
        <KpiCard title="Avg Risk Score" value={avgRisk.toFixed(1)} accent="#075f43" />
        <KpiCard title="Median Poverty" value={medianPoverty !== null ? `${medianPoverty.toFixed(1)}%` : "—"} accent="#fb8c00" />
        <KpiCard title="TRI Facilities" value={triFacilities.length.toString()} accent="#6b2e8c" />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Find Your Address</Text>
        <Text style={styles.bodyText}>
          Enter a Chicago address or use your device's location to see the environmental risk for your neighborhood.
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
            <Text style={styles.bodyText}>This location is outside Chicago's 77 community areas.</Text>
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
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{getCommunity(selected)}</Text>
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
            <Text style={styles.bodyText}>No public health data matched for this area.</Text>
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
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Not found</Text>
          <Text style={styles.bodyText}>"{search}" doesn't match any Chicago community area.</Text>
        </View>
      )}

      <View style={styles.mapCard}>
        <View style={styles.mapHeader}>
          <Text style={styles.cardTitle}>Map · Color by {METRIC_LABELS[colorBy]}</Text>
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

        <Text style={styles.bodyText}>
          {colorBy === "risk" && "Environmental risk choropleth. Switch to Poverty to see environmental justice patterns."}
          {colorBy === "poverty" && "Darker areas = higher poverty rate."}
          {colorBy === "income" && "Darker areas = lower per-capita income."}
          {colorBy === "unemployment" && "Darker areas = higher unemployment."}
          {colorBy === "ses_vulnerability" && "Composite vulnerability index."}
        </Text>

        {Platform.OS === "web" && geoData ? (
          React.createElement("iframe", {
            srcDoc: mapHtml,
            title: "Chicago Risk Map",
            style: { width: "100%", height: 700, border: "none", borderRadius: 12 },
          })
        ) : (
          <Text style={styles.bodyText}>Map only available on web.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top 10 Highest-Risk Neighborhoods</Text>
        {top10.map((item, i) => {
          const score = getDisplayRiskScore(item);
          const width = (score / top10Max) * 100;
          return (
            <View key={getCommunity(item)} style={styles.chartRow}>
              <Text style={styles.chartRank}>#{i + 1}</Text>
              <Text style={styles.chartName} numberOfLines={1}>{getCommunity(item)}</Text>
              <View style={styles.chartBarContainer}>
                <View style={[styles.chartBar, { width: `${width}%`, backgroundColor: getMetricColor(score) }]} />
                <Text style={styles.chartScore}>{score.toFixed(1)}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <View style={styles.compareHeader}>
          <Text style={styles.cardTitle}>Compare Two Neighborhoods</Text>
          <Pressable onPress={() => setShowCompare(!showCompare)} style={styles.toggleButtonSmall}>
            <Text style={styles.toggleButtonTextSmall}>{showCompare ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>
        {showCompare && (
          <>
            <View style={styles.compareInputs}>
              <TextInput style={styles.compareInput} placeholder="First area" placeholderTextColor="#9ca3af" value={compareA} onChangeText={setCompareA} />
              <TextInput style={styles.compareInput} placeholder="Second area" placeholderTextColor="#9ca3af" value={compareB} onChangeText={setCompareB} />
            </View>
            {areaA && areaB && (
              <View style={styles.compareGrid}>
                <ComparisonHeader nameA={getCommunity(areaA)} nameB={getCommunity(areaB)} />
                <ComparisonRow label="Display Risk" valueA={getDisplayRiskScore(areaA)} valueB={getDisplayRiskScore(areaB)} />
                <ComparisonRow label="Air Pollution" valueA={getSatelliteAirPollutionScore(areaA)} valueB={getSatelliteAirPollutionScore(areaB)} />
                <ComparisonRow label="Heat Exposure" valueA={getHeatRisk(areaA)} valueB={getHeatRisk(areaB)} />
                <ComparisonRow label="Green Space Risk" valueA={getGreenRisk(areaA)} valueB={getGreenRisk(areaB)} />
                <ComparisonRow label="Poverty %" valueA={getPoverty(areaA)} valueB={getPoverty(areaB)} />
                <ComparisonRow label="Unemployment %" valueA={getUnemployment(areaA)} valueB={getUnemployment(areaB)} />
              </View>
            )}
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>All 77 Community Areas</Text>
        <View style={styles.filterRow}>
          {(["All", "Low Risk", "Medium Risk", "High Risk"] as RiskFilter[]).map((f) => (
            <Pressable key={f} onPress={() => setRiskFilter(f)} style={[styles.filterButton, riskFilter === f && styles.filterButtonActive]}>
              <Text style={[styles.filterButtonText, riskFilter === f && styles.filterButtonTextActive]}>{f}</Text>
            </Pressable>
          ))}
        </View>
        {filtered.map((item, i) => {
          const score = getDisplayRiskScore(item);
          return (
            <View key={getCommunity(item)} style={styles.rankingRow}>
              <View style={[styles.colorIndicator, { backgroundColor: getMetricColor(score) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rankingName}>{i + 1}. {getCommunity(item)}</Text>
                <Text style={styles.riskLevelSmall}>{getRiskLevel(score)}</Text>
              </View>
              <Text style={[styles.rankingScore, { color: getMetricColor(score) }]}>{score.toFixed(1)}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <View style={styles.compareHeader}>
          <Text style={styles.cardTitle}>Methodology & Data Sources</Text>
          <Pressable onPress={() => setShowMethodology(!showMethodology)} style={styles.toggleButtonSmall}>
            <Text style={styles.toggleButtonTextSmall}>{showMethodology ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>
        <Text style={styles.formula}>
          Display Risk Score = 70% Original Risk + 10% Air Pollution + 10% Heat + 10% Green Space
        </Text>
        {showMethodology && (
          <>
            <DataSource title="Sentinel-2/5P, Landsat 8, MERRA-2" detail="Satellite via Google Earth Engine" />
            <DataSource title="EPA AirNow" detail="Hourly ground sensors" />
            <DataSource title="EPA Toxic Release Inventory" detail="Facility-level chemical reporting" />
            <DataSource title="Chicago Public Health Statistics" detail="data.cityofchicago.org (iqnk-2tcu)" />
            <DataSource title="Open-Meteo" detail="Weather + forecast (free, no API key)" />
            <DataSource title="Esri World Imagery" detail="Satellite basemap" />
            <DataSource title="OpenStreetMap Nominatim" detail="Address geocoding" />
          </>
        )}
      </View>

      <Text style={styles.footer}>
        EnviroSight Chicago · Satellite · EPA · Chicago Data Portal · Open-Meteo · OpenStreetMap
      </Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function KpiCard({ title, value, accent }: { title: string; value: string; accent: string }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiTitle}>{title}</Text>
      <Text style={[styles.kpiValue, { color: accent }]}>{value}</Text>
    </View>
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

function ComparisonHeader({ nameA, nameB }: { nameA: string; nameB: string }) {
  return (
    <View style={styles.compareHeaderRow}>
      <Text style={[styles.compareCell, styles.compareCellHeader]}>Indicator</Text>
      <Text style={[styles.compareCell, styles.compareCellHeader]} numberOfLines={1}>{nameA}</Text>
      <Text style={[styles.compareCell, styles.compareCellHeader]} numberOfLines={1}>{nameB}</Text>
    </View>
  );
}

function ComparisonRow({ label, valueA, valueB }: { label: string; valueA: number; valueB: number }) {
  const higher = valueA > valueB ? "A" : valueB > valueA ? "B" : "tie";
  const safeA = Number.isFinite(valueA) ? valueA.toFixed(1) : "N/A";
  const safeB = Number.isFinite(valueB) ? valueB.toFixed(1) : "N/A";
  return (
    <View style={styles.compareDataRow}>
      <Text style={styles.compareCell}>{label}</Text>
      <Text style={[styles.compareCell, styles.compareValue, { color: higher === "A" ? "#c62828" : "#374151", fontWeight: higher === "A" ? "900" : "600" }]}>{safeA}</Text>
      <Text style={[styles.compareCell, styles.compareValue, { color: higher === "B" ? "#c62828" : "#374151", fontWeight: higher === "B" ? "900" : "600" }]}>{safeB}</Text>
    </View>
  );
}

function DataSource({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.sourceRow}>
      <Text style={styles.sourceTitle}>{title}</Text>
      <Text style={styles.sourceDetail}>{detail}</Text>
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
  page: { flex: 1, backgroundColor: "#f6faf7" },
  hero: { backgroundColor: "#075f43", padding: 34, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  title: { color: "white", fontSize: 38, fontWeight: "800", marginBottom: 8, letterSpacing: -0.5 },
  subtitle: { color: "#a7f3d0", fontSize: 18, fontWeight: "600", marginBottom: 12 },
  description: { color: "rgba(255,255,255,0.92)", fontSize: 15, lineHeight: 22 },

  liveBanner: { backgroundColor: "white", margin: 20, marginBottom: 0, padding: 16, borderRadius: 14, borderLeftWidth: 4 },
  liveBannerRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  liveBannerTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  liveBannerSubtext: { fontSize: 13, color: "#6b7280", marginLeft: 20 },

  // Weather card
  weatherCard: { marginHorizontal: 20, marginTop: 12, padding: 22, borderRadius: 18 },
  weatherHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  weatherLocation: { color: "white", fontSize: 14, fontWeight: "800", letterSpacing: 0.5 },
  weatherSource: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontStyle: "italic" },
  weatherMainRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 20 },
  weatherEmoji: { fontSize: 80 },
  weatherMainText: { flex: 1 },
  weatherTemp: { color: "white", fontSize: 56, fontWeight: "900", lineHeight: 58 },
  weatherCondition: { color: "white", fontSize: 18, fontWeight: "700", marginTop: 4 },
  weatherFeels: { color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 4 },
  weatherStatsRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 20 },
  weatherStat: { backgroundColor: "rgba(255,255,255,0.12)", padding: 12, borderRadius: 10, flexGrow: 1, flexBasis: 110, minWidth: 110 },
  weatherStatLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 },
  weatherStatValue: { color: "white", fontSize: 15, fontWeight: "800" },
  weatherForecastLabel: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "800", letterSpacing: 0.5, marginBottom: 10 },
  forecastScroll: { marginHorizontal: -4 },
  forecastDay: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12, padding: 12, marginHorizontal: 4, alignItems: "center", minWidth: 72 },
  forecastDayName: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "800", marginBottom: 6 },
  forecastEmoji: { fontSize: 28, marginBottom: 6 },
  forecastTempHigh: { color: "white", fontSize: 16, fontWeight: "900" },
  forecastTempLow: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "700" },
  forecastPrecip: { color: "#7dd3fc", fontSize: 10, fontWeight: "700", marginTop: 4 },
  sunRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.2)" },
  sunText: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "600" },

  aqiBanner: { backgroundColor: "white", marginHorizontal: 20, marginTop: 12, padding: 18, borderRadius: 14, borderLeftWidth: 4 },
  aqiHeader: { flexDirection: "row", alignItems: "flex-start", gap: 20 },
  aqiLabel: { fontSize: 11, fontWeight: "800", color: "#6b7280", letterSpacing: 0.5, marginBottom: 4 },
  aqiValue: { fontSize: 36, fontWeight: "900", lineHeight: 40 },
  aqiCategory: { fontSize: 14, fontWeight: "700", color: "#374151", marginTop: 2 },
  aqiParams: { gap: 4 },
  aqiParamRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, minWidth: 100 },
  aqiParamName: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  aqiParamValue: { fontSize: 14, fontWeight: "800", color: "#111827" },
  aqiTimestamp: { fontSize: 11, color: "#9ca3af", marginTop: 10, fontStyle: "italic" },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, margin: 20 },
  kpiCard: { flexGrow: 1, flexBasis: 160, backgroundColor: "white", padding: 18, borderRadius: 16, borderWidth: 1, borderColor: "#e5e7eb" },
  kpiTitle: { fontSize: 12, color: "#6b7280", fontWeight: "700", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  kpiValue: { fontSize: 22, fontWeight: "900" },

  addressInputRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  addressInput: { flex: 1, padding: 14, borderWidth: 1.5, borderColor: "#d1d5db", borderRadius: 12, backgroundColor: "white", fontSize: 16 },
  addressSearchButton: { backgroundColor: "#075f43", paddingHorizontal: 22, justifyContent: "center", borderRadius: 12, minWidth: 90, alignItems: "center" },
  addressSearchButtonText: { color: "white", fontWeight: "800", fontSize: 14 },
  addressActionRow: { flexDirection: "row", gap: 10, marginTop: 10, alignItems: "center" },
  locationButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, borderColor: "#075f43", backgroundColor: "white" },
  locationButtonText: { color: "#075f43", fontWeight: "800", fontSize: 13 },
  clearButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, backgroundColor: "#f3f4f6" },
  clearButtonText: { color: "#6b7280", fontWeight: "700", fontSize: 13 },
  errorText: { color: "#c62828", fontSize: 13, marginTop: 10, fontWeight: "600" },

  pinResult: { marginTop: 16, padding: 16, backgroundColor: "#f7fbf8", borderRadius: 12, borderLeftWidth: 3, borderLeftColor: "#075f43" },
  pinResultLabel: { fontSize: 13, color: "#6b7280", fontWeight: "700", marginBottom: 4 },
  pinResultName: { fontSize: 22, fontWeight: "900", color: "#075f43", marginBottom: 8 },
  pinQuickStats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  quickStat: { backgroundColor: "white", padding: 10, borderRadius: 10, flexGrow: 1, flexBasis: 100, borderWidth: 1, borderColor: "#e5e7eb" },
  quickStatLabel: { fontSize: 10, color: "#6b7280", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  quickStatValue: { fontSize: 16, fontWeight: "900", color: "#111827" },

  search: { marginHorizontal: 20, marginBottom: 20, padding: 14, borderWidth: 1.5, borderColor: "#075f43", borderRadius: 12, backgroundColor: "white", fontSize: 16 },

  card: { backgroundColor: "white", marginHorizontal: 20, marginBottom: 20, padding: 22, borderRadius: 18, borderWidth: 1, borderColor: "#e5e7eb" },
  mapCard: { backgroundColor: "white", marginHorizontal: 20, marginBottom: 20, padding: 22, borderRadius: 18, borderWidth: 1, borderColor: "#e5e7eb", overflow: "hidden" },
  mapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 },
  cardTitle: { fontSize: 22, fontWeight: "800", color: "#075f43", marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: "#075f43", marginTop: 18, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  bodyText: { fontSize: 14, lineHeight: 22, color: "#374151", marginBottom: 8 },

  metricLabel: { fontSize: 11, fontWeight: "800", color: "#6b7280", letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  colorByRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  colorByButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: "#d1d5db", backgroundColor: "white" },
  colorByButtonActive: { backgroundColor: "#075f43", borderColor: "#075f43" },
  colorByButtonText: { color: "#374151", fontWeight: "700", fontSize: 12 },
  colorByButtonTextActive: { color: "white" },

  basemapToggle: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "#111827" },
  basemapToggleText: { color: "white", fontWeight: "800", fontSize: 13 },

  scoreRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 12 },
  bigScore: { fontSize: 48, fontWeight: "900", lineHeight: 52 },
  riskPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  riskPillText: { color: "white", fontWeight: "800", fontSize: 13 },

  explainBox: { backgroundColor: "#f7fbf8", borderLeftWidth: 3, borderLeftColor: "#075f43", padding: 14, borderRadius: 10, marginBottom: 8 },
  explainText: { fontSize: 14, lineHeight: 22, color: "#374151" },

  formula: { fontSize: 14, fontWeight: "700", color: "#075f43", backgroundColor: "#eef8f2", padding: 14, borderRadius: 12, marginBottom: 12, lineHeight: 22 },

  chartRow: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 8 },
  chartRank: { width: 30, fontWeight: "800", color: "#9ca3af", fontSize: 13 },
  chartName: { width: 140, fontWeight: "700", color: "#111827", fontSize: 13 },
  chartBarContainer: { flex: 1, height: 24, backgroundColor: "#f3f4f6", borderRadius: 6, overflow: "hidden", justifyContent: "center", position: "relative" },
  chartBar: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 6 },
  chartScore: { position: "absolute", right: 8, fontWeight: "900", color: "#111827", fontSize: 12 },

  compareHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  toggleGroup: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  toggleButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: "#075f43", backgroundColor: "white" },
  toggleButtonActive: { backgroundColor: "#075f43", borderColor: "#075f43" },
  toggleButtonActiveTri: { backgroundColor: "#6b2e8c", borderColor: "#6b2e8c" },
  toggleButtonText: { color: "#075f43", fontWeight: "800", fontSize: 12 },
  toggleButtonTextActive: { color: "white" },

  toggleButtonSmall: { backgroundColor: "#075f43", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  toggleButtonTextSmall: { color: "white", fontWeight: "800", fontSize: 12 },

  compareInputs: { gap: 10, marginTop: 12, marginBottom: 16 },
  compareInput: { padding: 12, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, backgroundColor: "#f9fafb", fontSize: 14 },
  compareGrid: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, overflow: "hidden" },
  compareHeaderRow: { flexDirection: "row", backgroundColor: "#eef8f2", paddingVertical: 10 },
  compareDataRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#e5e7eb", paddingVertical: 10 },
  compareCell: { flex: 1, paddingHorizontal: 10, fontSize: 13, color: "#374151" },
  compareCellHeader: { fontWeight: "800", color: "#075f43", textTransform: "uppercase", fontSize: 11, letterSpacing: 0.5 },
  compareValue: { textAlign: "right", fontVariant: ["tabular-nums"] },

  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 12 },
  filterButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: "#075f43", backgroundColor: "white" },
  filterButtonActive: { backgroundColor: "#075f43" },
  filterButtonText: { color: "#075f43", fontWeight: "800", fontSize: 13 },
  filterButtonTextActive: { color: "white" },
  rankingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  colorIndicator: { width: 6, height: 36, borderRadius: 3 },
  rankingName: { fontWeight: "700", color: "#111827", fontSize: 14 },
  riskLevelSmall: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  rankingScore: { fontWeight: "900", fontSize: 18 },

  scoreBarWrapper: { marginTop: 12 },
  scoreBarHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  scoreBarLabel: { fontWeight: "700", color: "#374151", fontSize: 13 },
  scoreBarValue: { fontWeight: "900", fontSize: 13 },
  scoreBarTrack: { height: 10, backgroundColor: "#f3f4f6", borderRadius: 999, overflow: "hidden" },
  scoreBarFill: { height: "100%", borderRadius: 999 },

  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  infoLabel: { fontWeight: "600", color: "#6b7280", fontSize: 13 },
  infoValue: { fontWeight: "800", color: "#111827", fontSize: 13 },

  sourceRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  sourceTitle: { fontSize: 14, fontWeight: "800", color: "#075f43" },
  sourceDetail: { fontSize: 12, color: "#6b7280", marginTop: 2 },

  footer: { textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 8, paddingHorizontal: 20 },
});

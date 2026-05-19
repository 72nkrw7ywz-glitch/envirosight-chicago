export const API_BASE = "https://envirosight-chicago.onrender.com";

export const RISK_COLORS = {
  veryLow: "#2e7d32",
  low: "#9ccc65",
  medium: "#fdd835",
  high: "#fb8c00",
  veryHigh: "#c62828",
};

export type FeatureProperties = { community?: string; COMMUNITY?: string; [key: string]: any };
export type GeoJsonFeature = { type: string; properties: FeatureProperties; geometry: any };
export type ColorByMetric = "risk" | "poverty" | "income" | "unemployment" | "ses_vulnerability";

export const METRIC_LABELS: Record<ColorByMetric, string> = {
  risk: "Environmental Risk",
  poverty: "Poverty Rate",
  income: "Income (lower = darker)",
  unemployment: "Unemployment Rate",
  ses_vulnerability: "Socioeconomic Vulnerability",
};

export type AirNowStation = {
  latitude: number; longitude: number; site_name: string; agency: string;
  worst_aqi: number; worst_parameter: string; color: string; category: string;
  readings: Record<string, { aqi: number; value: number; unit: string; utc: string }>;
};
export type AirNowSummary = {
  available: boolean; worst_aqi?: number; worst_category?: string; worst_color?: string;
  observed_at?: string; reporting_area?: string;
  by_parameter?: Record<string, { aqi: number; category: string }>;
};
export type TriFacility = {
  id: string; name: string; address: string; city: string; zip: string;
  industry: string; latitude: number; longitude: number;
};
export type SuperfundSite = {
  id: string; name: string; zip: string; status: string; latitude: number; longitude: number;
  address?: string; city?: string; category?: string; profile_url?: string;
};

export function getValue(p: any, keys: string[], fb: any = "N/A"): any {
  for (const k of keys) if (p && p[k] !== undefined && p[k] !== null && p[k] !== "") return p[k];
  return fb;
}

export function toNumber(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function formatNumber(v: any, d = 1): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : "N/A";
}

export const getCommunity = (p: any): string =>
  String(getValue(p, ["community", "COMMUNITY", "community_area", "community_n", "name"], "Unknown"));

export const getOriginalRiskScore = (p: any): number =>
  toNumber(getValue(p, ["new_risk_s", "new_risk_score", "risk_score", "risk_scor", "new_risk", "risk"], 0));

export const getSatelliteAirPollutionScore = (p: any): number =>
  toNumber(getValue(p, ["satellite_air_pollution_score"], 0));

export const getHeatRisk = (p: any): number =>
  toNumber(getValue(p, ["heat_exposure_score"], 0));

export const getGreenRisk = (p: any): number =>
  toNumber(getValue(p, ["green_space_risk_score"], 0));

export function getDisplayRiskScore(p: any): number {
  const d = toNumber(getValue(p, ["display_risk_score"], 0));
  if (d > 0) return d;
  return getOriginalRiskScore(p) * 0.7 + getSatelliteAirPollutionScore(p) * 0.1 + getHeatRisk(p) * 0.1 + getGreenRisk(p) * 0.1;
}

export const getRiskLevel = (s: number): string =>
  s >= 70 ? "High Risk" : s >= 40 ? "Medium Risk" : "Low Risk";

export const getPoverty = (p: any): number => Number(getValue(p, ["ph_below_poverty_level"], NaN));
export const getUnemployment = (p: any): number => Number(getValue(p, ["ph_unemployment"], NaN));
export const getNoHsDiploma = (p: any): number => Number(getValue(p, ["ph_no_high_school_diploma"], NaN));
export const getIncome = (p: any): number => Number(getValue(p, ["ph_per_capita_income"], NaN));
export const getCrowdedHousing = (p: any): number => Number(getValue(p, ["ph_crowded_housing"], NaN));
export const getSesVulnerability = (p: any): number => Number(getValue(p, ["ph_ses_vulnerability_score"], NaN));

export function getMetricValue(p: any, metric: ColorByMetric): number {
  switch (metric) {
    case "risk": return getDisplayRiskScore(p);
    case "poverty": return getPoverty(p);
    case "income": return getIncome(p);
    case "unemployment": return getUnemployment(p);
    case "ses_vulnerability": return getSesVulnerability(p);
  }
}

export function buildQuintileColorFn(values: number[], reversed = false) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const quintiles = sorted.length > 0
    ? [0.2, 0.4, 0.6, 0.8].map((p) => sorted[Math.floor(sorted.length * p)])
    : [0, 0, 0, 0];
  return (score: number): string => {
    if (!Number.isFinite(score)) return "#cccccc";
    let bin = 0;
    if (score <= quintiles[0]) bin = 0;
    else if (score <= quintiles[1]) bin = 1;
    else if (score <= quintiles[2]) bin = 2;
    else if (score <= quintiles[3]) bin = 3;
    else bin = 4;
    if (reversed) bin = 4 - bin;
    return [RISK_COLORS.veryLow, RISK_COLORS.low, RISK_COLORS.medium, RISK_COLORS.high, RISK_COLORS.veryHigh][bin];
  };
}

// ─── Geometry / distance ─────────────────────────────────────────────────────

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Saved addresses (My Places) ─────────────────────────────────────────────

export type SavedPlace = { id: string; label: string; lat: number; lng: number; addedAt: string };
const SAVED_PLACES_KEY = "envirosight:saved-places";

export function loadSavedPlaces(): SavedPlace[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(SAVED_PLACES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistSavedPlaces(places: SavedPlace[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(places));
  } catch {}
}

// ─── Personal health risk score ──────────────────────────────────────────────

export type PersonalRisk = {
  score: number;
  level: "Low" | "Moderate" | "Elevated" | "High";
  drivers: { label: string; weight: number; value: number }[];
};

export function computePersonalRisk(featureProps: any, currentAqi?: number | null): PersonalRisk {
  const ses = getSesVulnerability(featureProps);
  const heat = getHeatRisk(featureProps);
  const green = getGreenRisk(featureProps);
  const satAir = getSatelliteAirPollutionScore(featureProps);
  const aqi = typeof currentAqi === "number" && Number.isFinite(currentAqi) ? currentAqi : NaN;
  // Convert AQI (0-500 scale) into a roughly comparable 0-100 weight
  const aqiContribution = Number.isFinite(aqi) ? Math.min(100, (aqi / 150) * 100) : satAir;

  const drivers = [
    { label: "Current air quality", weight: 0.30, value: aqiContribution },
    { label: "Long-term air pollution", weight: 0.25, value: satAir },
    { label: "Urban heat exposure", weight: 0.15, value: heat },
    { label: "Limited green space", weight: 0.10, value: green },
    { label: "Socioeconomic vulnerability", weight: 0.20, value: Number.isFinite(ses) ? ses : 0 },
  ];

  const total = drivers.reduce((s, d) => s + d.value * d.weight, 0);
  const score = Math.round(total * 10) / 10;
  const level: PersonalRisk["level"] =
    score >= 70 ? "High" : score >= 50 ? "Elevated" : score >= 30 ? "Moderate" : "Low";

  return {
    score,
    level,
    drivers: drivers.sort((a, b) => b.value * b.weight - a.value * a.weight),
  };
}

// ─── Theme tokens ────────────────────────────────────────────────────────────

export type ThemeName = "light" | "dark";

export type ThemeTokens = {
  name: ThemeName;
  bg: string;            // page background
  card: string;          // card background
  cardElevated: string;  // nested card / "raised" surfaces
  border: string;        // dividers and outlines
  borderStrong: string;  // emphasized borders
  text: string;          // primary text
  textMuted: string;     // labels, secondary text
  textSubtle: string;    // captions, footer
  brand: string;         // primary brand color (stays green)
  brandTint: string;     // brand-tinted background (selected state, highlights)
  accent: string;        // secondary accent (orange used for warnings)
  danger: string;
  success: string;
  warning: string;
  inputBg: string;
  inputBorder: string;
  shadowColor: string;
  shadowOpacity: number;
  overlay: string;
};

export const LIGHT_THEME: ThemeTokens = {
  name: "light",
  bg: "#f9fafb",
  card: "#ffffff",
  cardElevated: "#f9fafb",
  border: "#f3f4f6",
  borderStrong: "#e5e7eb",
  text: "#111827",
  textMuted: "#6b7280",
  textSubtle: "#9ca3af",
  brand: "#075f43",
  brandTint: "#eef8f2",
  accent: "#fb8c00",
  danger: "#c62828",
  success: "#10b981",
  warning: "#f59e0b",
  inputBg: "#f9fafb",
  inputBorder: "#d1d5db",
  shadowColor: "#000000",
  shadowOpacity: 0.04,
  overlay: "rgba(0,0,0,0.5)",
};

export const DARK_THEME: ThemeTokens = {
  name: "dark",
  bg: "#0b1014",
  card: "#161b22",
  cardElevated: "#1f2937",
  border: "#1f2937",
  borderStrong: "#374151",
  text: "#f9fafb",
  textMuted: "#9ca3af",
  textSubtle: "#6b7280",
  brand: "#10b981",
  brandTint: "#10341f",
  accent: "#fb923c",
  danger: "#ef4444",
  success: "#10b981",
  warning: "#f59e0b",
  inputBg: "#1f2937",
  inputBorder: "#374151",
  shadowColor: "#000000",
  shadowOpacity: 0.4,
  overlay: "rgba(0,0,0,0.7)",
};

const THEME_STORAGE_KEY = "envirosight:theme";

export function loadThemePreference(): ThemeName | "auto" {
  if (typeof window === "undefined" || !window.localStorage) return "auto";
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {}
  return "auto";
}

export function persistThemePreference(pref: ThemeName | "auto"): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try { window.localStorage.setItem(THEME_STORAGE_KEY, pref); } catch {}
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
}

export function resolveTheme(pref: ThemeName | "auto"): ThemeTokens {
  if (pref === "dark") return DARK_THEME;
  if (pref === "light") return LIGHT_THEME;
  return getSystemPrefersDark() ? DARK_THEME : LIGHT_THEME;
}

export function makeSharedStyles(t: ThemeTokens) {
  return {
    page: { flex: 1, backgroundColor: t.bg },
    hero: { backgroundColor: t.brand, padding: 24, paddingTop: 32, paddingBottom: 28 },
    heroTitle: { color: "#ffffff", fontSize: 28, fontWeight: "800" as const, marginBottom: 4 },
    heroSubtitle: { color: "#86efac", fontSize: 15, fontWeight: "600" as const, marginBottom: 10 },
    heroDescription: { color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 19 },
    card: { backgroundColor: t.card, margin: 20, marginTop: 16, marginBottom: 0, padding: 20, borderRadius: 14, shadowColor: t.shadowColor, shadowOpacity: t.shadowOpacity, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
    cardTitle: { fontSize: 20, fontWeight: "800" as const, color: t.brand, marginBottom: 10 },
    cardSubtitle: { fontSize: 13, color: t.textMuted, marginBottom: 14 },
    bodyText: { fontSize: 14, color: t.text, lineHeight: 20 },
    footer: { textAlign: "center" as const, color: t.textSubtle, fontSize: 12, marginTop: 28, paddingHorizontal: 20 },
    copyright: { textAlign: "center" as const, color: t.textSubtle, fontSize: 11, marginTop: 6, paddingHorizontal: 20, marginBottom: 40 },
  };
}

/**
 * Hook returning the active theme + a setter. Subscribes to OS theme changes when pref is "auto".
 * Use this once near the top of each screen, then derive styles via makeSharedStyles(theme) or createStyles(theme).
 */
import { useEffect, useState, useCallback } from "react";

export function useEnviroTheme() {
  const [pref, setPref] = useState<ThemeName | "auto">(loadThemePreference());
  const [system, setSystem] = useState<boolean>(getSystemPrefersDark());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystem(e.matches);
    try {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } catch {
      // older browsers
      mq.addListener(handler);
      return () => mq.removeListener(handler);
    }
  }, []);

  const theme: ThemeTokens =
    pref === "dark" ? DARK_THEME :
    pref === "light" ? LIGHT_THEME :
    system ? DARK_THEME : LIGHT_THEME;

  const setThemePreference = useCallback((next: ThemeName | "auto") => {
    setPref(next);
    persistThemePreference(next);
  }, []);

  return { theme, pref, setThemePreference };
}

// Legacy export — kept so existing imports don't break. Returns the light theme styles.
export const sharedStyles = makeSharedStyles(LIGHT_THEME);

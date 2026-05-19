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

export const sharedStyles = {
  page: { flex: 1, backgroundColor: "#f9fafb" },
  hero: { backgroundColor: "#075f43", padding: 24, paddingTop: 32, paddingBottom: 28 },
  heroTitle: { color: "white", fontSize: 28, fontWeight: "800" as const, marginBottom: 4 },
  heroSubtitle: { color: "#86efac", fontSize: 15, fontWeight: "600" as const, marginBottom: 10 },
  heroDescription: { color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: "white", margin: 20, marginTop: 16, marginBottom: 0, padding: 20, borderRadius: 14, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardTitle: { fontSize: 20, fontWeight: "800" as const, color: "#075f43", marginBottom: 10 },
  cardSubtitle: { fontSize: 13, color: "#6b7280", marginBottom: 14 },
  bodyText: { fontSize: 14, color: "#374151", lineHeight: 20 },
  footer: { textAlign: "center" as const, color: "#9ca3af", fontSize: 12, marginTop: 28, paddingHorizontal: 20 },
  copyright: { textAlign: "center" as const, color: "#9ca3af", fontSize: 11, marginTop: 6, paddingHorizontal: 20, marginBottom: 40 },
};

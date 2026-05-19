import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { useMemo } from "react";
import {
  API_BASE,
  AirNowStation,
  AirNowSummary,
  SuperfundSite,
  ThemeTokens,
  TriFacility,
  makeSharedStyles,
  useEnviroTheme,
} from "@/lib/envirosight";

type AirNowForecastDay = {
  date: string; worst_aqi: number; worst_category: string; worst_color: string;
  worst_parameter: string; discussion?: string;
  by_parameter: Record<string, { aqi: number; category: string; color: string }>;
};
type AirNowForecast = { available: boolean; days?: AirNowForecastDay[] };

export default function SitesScreen() {
  const { theme } = useEnviroTheme();
  const sharedStyles = useMemo(() => makeSharedStyles(theme), [theme]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const SummaryCard = ({ label, value, accent }: { label: string; value: number; accent: string }) => (
    <View style={styles.summaryCard}>
      <Text style={[styles.summaryValue, { color: accent }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );

  const [airnowStations, setAirnowStations] = useState<AirNowStation[]>([]);
  const [airnowSummary, setAirnowSummary] = useState<AirNowSummary | null>(null);
  const [airnowForecast, setAirnowForecast] = useState<AirNowForecast | null>(null);
  const [superfundSites, setSuperfundSites] = useState<SuperfundSite[]>([]);
  const [triFacilities, setTriFacilities] = useState<TriFacility[]>([]);
  const [showSuperfundList, setShowSuperfundList] = useState(true);
  const [showTriList, setShowTriList] = useState(false);
  const [showStationList, setShowStationList] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [s, sum, tri, sf, fc] = await Promise.all([
          fetch(`${API_BASE}/api/airnow-stations`),
          fetch(`${API_BASE}/api/airnow-summary`),
          fetch(`${API_BASE}/api/tri-facilities`, { signal: AbortSignal.timeout(60000) }),
          fetch(`${API_BASE}/api/superfund-sites`),
          fetch(`${API_BASE}/api/airnow-forecast`),
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
        if (sf.ok) {
          const d = await sf.json();
          if (d.available && Array.isArray(d.sites)) setSuperfundSites(d.sites);
        }
        if (fc.ok) setAirnowForecast(await fc.json());
      } catch (err) {
        console.warn("Sites data fetch failed:", err);
      }
    })();
  }, []);

  const openSuperfundReport = (siteId: string) => {
    const url = `https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.scs&id=${siteId}`;
    if (typeof window !== "undefined") window.open(url, "_blank");
  };

  return (
    <ScrollView style={sharedStyles.page}>
      <View style={sharedStyles.hero}>
        <Text style={sharedStyles.heroTitle}>Sites Near You</Text>
        <Text style={sharedStyles.heroSubtitle}>Pollution sources · cleanup sites · air monitors</Text>
        <Text style={sharedStyles.heroDescription}>
          EPA-tracked pollution facilities, federal Superfund cleanup sites, and live air quality monitoring stations across Chicago.
        </Text>
      </View>

      {airnowSummary?.available && (
        <View style={[styles.aqiBanner, { borderLeftColor: airnowSummary.worst_color }]}>
          <Text style={styles.aqiLabel}>LIVE EPA AIR QUALITY · {airnowSummary.reporting_area?.toUpperCase()}</Text>
          <Text style={[styles.aqiValue, { color: airnowSummary.worst_color }]}>{airnowSummary.worst_aqi} AQI</Text>
          <Text style={styles.aqiCategory}>{airnowSummary.worst_category}</Text>
          {airnowSummary.by_parameter && (
            <View style={styles.aqiParams}>
              {Object.entries(airnowSummary.by_parameter).map(([param, data]) => (
                <View key={param} style={styles.aqiParamRow}>
                  <Text style={styles.aqiParamName}>{param}</Text>
                  <Text style={styles.aqiParamValue}>{data.aqi}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={styles.aqiTimestamp}>Observed {airnowSummary.observed_at}</Text>
        </View>
      )}

      {airnowForecast?.available && airnowForecast.days && airnowForecast.days.length > 0 && (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>Air Quality Forecast</Text>
          <Text style={sharedStyles.cardSubtitle}>Issued by EPA AirNow for the Chicago reporting area.</Text>
          <View style={styles.forecastRow}>
            {airnowForecast.days.slice(0, 4).map((day) => (
              <View key={day.date} style={styles.forecastDay}>
                <Text style={styles.forecastDate}>
                  {new Date(day.date + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" })}
                </Text>
                <Text style={[styles.forecastAqi, { color: day.worst_color }]}>{day.worst_aqi}</Text>
                <Text style={styles.forecastCat}>{day.worst_category}</Text>
                <Text style={styles.forecastParam}>{day.worst_parameter}</Text>
              </View>
            ))}
          </View>
          {airnowForecast.days[0]?.discussion && (
            <Text style={styles.forecastDiscussion}>{airnowForecast.days[0].discussion}</Text>
          )}
        </View>
      )}

      <View style={styles.summaryRow}>
        <SummaryCard label="AirNow Stations" value={airnowStations.length} accent="#00a89d" />
        <SummaryCard label="Superfund Sites" value={superfundSites.length} accent="#c62828" />
        <SummaryCard label="TRI Facilities" value={triFacilities.length} accent="#6b2e8c" />
      </View>

      {superfundSites.length > 0 && (
        <View style={sharedStyles.card}>
          <View style={styles.sectionHeader}>
            <Text style={sharedStyles.cardTitle}>☢ Superfund Sites ({superfundSites.length})</Text>
            <Pressable onPress={() => setShowSuperfundList(!showSuperfundList)} style={styles.toggleButtonSmall}>
              <Text style={styles.toggleButtonTextSmall}>{showSuperfundList ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>
          <Text style={sharedStyles.cardSubtitle}>
            EPA-designated contaminated sites. Tap a site for the full EPA report.
          </Text>
          {showSuperfundList && superfundSites.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => openSuperfundReport(s.id)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            >
              <View style={[styles.rowDot, { backgroundColor: s.status === "Final NPL" || s.status === "NPL" ? "#c62828" : "#fb8c00" }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{s.name}</Text>
                <Text style={styles.rowMeta}>
                  {s.status}
                  {s.zip ? ` · ZIP ${s.zip}` : ""}
                  {s.category ? ` · ${s.category}` : ""}
                  {" · Tap for EPA report ↗"}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {triFacilities.length > 0 && (
        <View style={sharedStyles.card}>
          <View style={styles.sectionHeader}>
            <Text style={sharedStyles.cardTitle}>🏭 TRI Facilities ({triFacilities.length})</Text>
            <Pressable onPress={() => setShowTriList(!showTriList)} style={styles.toggleButtonSmall}>
              <Text style={styles.toggleButtonTextSmall}>{showTriList ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>
          <Text style={sharedStyles.cardSubtitle}>
            Facilities reporting chemical releases to EPA's Toxic Release Inventory.
          </Text>
          {showTriList && triFacilities.map((f) => (
            <View key={f.id} style={styles.row}>
              <View style={[styles.rowDot, { backgroundColor: "#6b2e8c" }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{f.name}</Text>
                <Text style={styles.rowMeta}>
                  {f.address}
                  {f.city ? `, ${f.city}` : ""}
                  {f.zip ? ` ${f.zip}` : ""}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {airnowStations.length > 0 && (
        <View style={sharedStyles.card}>
          <View style={styles.sectionHeader}>
            <Text style={sharedStyles.cardTitle}>🌬 Air Quality Monitors ({airnowStations.length})</Text>
            <Pressable onPress={() => setShowStationList(!showStationList)} style={styles.toggleButtonSmall}>
              <Text style={styles.toggleButtonTextSmall}>{showStationList ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>
          <Text style={sharedStyles.cardSubtitle}>
            EPA AirNow ground sensors reporting in the last 2 hours.
          </Text>
          {showStationList && airnowStations.map((s, i) => (
            <View key={`${s.site_name}-${i}`} style={styles.row}>
              <View style={[styles.rowDot, { backgroundColor: s.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{s.site_name}</Text>
                <Text style={styles.rowMeta}>
                  {s.worst_aqi} AQI · {s.category} · worst parameter: {s.worst_parameter}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <Text style={sharedStyles.footer}>
        Data: EPA Envirofacts · EPA AirNow · EPA Superfund (SEMS)
      </Text>
      <Text style={sharedStyles.copyright}>
        © {new Date().getFullYear()} EnviroSight Chicago. All rights reserved.
      </Text>
    </ScrollView>
  );
}

const createStyles = (t: ThemeTokens) => StyleSheet.create({
  aqiBanner: {
    backgroundColor: t.card, margin: 20, marginBottom: 0, padding: 20, borderRadius: 14,
    borderLeftWidth: 4, shadowColor: t.shadowColor, shadowOpacity: t.shadowOpacity, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  aqiLabel: { fontSize: 11, fontWeight: "800", color: t.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  aqiValue: { fontSize: 42, fontWeight: "900", lineHeight: 46 },
  aqiCategory: { fontSize: 15, fontWeight: "700", color: t.text, marginTop: 2, marginBottom: 12 },
  aqiParams: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 10 },
  aqiParamRow: {
    backgroundColor: t.cardElevated, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    flexDirection: "row", gap: 6, alignItems: "center",
  },
  aqiParamName: { fontSize: 11, fontWeight: "700", color: t.textMuted },
  aqiParamValue: { fontSize: 13, fontWeight: "800", color: t.text },
  aqiTimestamp: { fontSize: 11, color: t.textSubtle, marginTop: 4 },

  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 20, marginTop: 16 },
  summaryCard: {
    flex: 1, minWidth: 100, backgroundColor: t.card, padding: 14, borderRadius: 12,
    shadowColor: t.shadowColor, shadowOpacity: t.shadowOpacity, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  summaryValue: { fontSize: 28, fontWeight: "900", lineHeight: 32 },
  summaryLabel: { fontSize: 11, fontWeight: "700", color: t.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  toggleButtonSmall: { backgroundColor: t.brand, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  toggleButtonTextSmall: { color: "white", fontWeight: "800", fontSize: 12 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12,
    paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: t.border,
  },
  rowDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  rowName: { fontWeight: "700", color: t.text, fontSize: 14 },
  rowMeta: { color: t.textMuted, fontSize: 12, marginTop: 2 },

  forecastRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  forecastDay: { flex: 1, backgroundColor: t.cardElevated, padding: 12, borderRadius: 10, alignItems: "center", minWidth: 80 },
  forecastDate: { fontSize: 11, fontWeight: "700", color: t.textMuted, marginBottom: 4 },
  forecastAqi: { fontSize: 28, fontWeight: "900", lineHeight: 30 },
  forecastCat: { fontSize: 11, fontWeight: "700", color: t.text, marginTop: 2, textAlign: "center" },
  forecastParam: { fontSize: 10, color: t.textMuted, marginTop: 2 },
  forecastDiscussion: { marginTop: 14, fontSize: 12, color: t.text, lineHeight: 18, fontStyle: "italic" },
});


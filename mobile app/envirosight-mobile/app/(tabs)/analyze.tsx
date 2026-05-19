import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable } from "react-native";
import {
  API_BASE,
  FeatureProperties,
  GeoJsonFeature,
  ThemeTokens,
  buildQuintileColorFn,
  getCommunity,
  getDisplayRiskScore,
  getGreenRisk,
  getHeatRisk,
  getIncome,
  getPoverty,
  getRiskLevel,
  getSatelliteAirPollutionScore,
  getUnemployment,
  makeSharedStyles,
  useEnviroTheme,
} from "@/lib/envirosight";

type InsightsTab = "distribution" | "search" | "health" | "ej";
type AqsSeries = Record<string, { month: string; mean: number; unit: string; n: number }[]>;
type AqsHistory = { available: boolean; message?: string; series?: AqsSeries; county?: string };

export default function AnalyzeScreen() {
  const { theme } = useEnviroTheme();
  const sharedStyles = useMemo(() => makeSharedStyles(theme), [theme]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const DistCard = ({ count, pct, label, color }: { count: number; pct: number; label: string; color: string }) => (
    <View style={styles.distCard}>
      <Text style={[styles.distValue, { color }]}>{count}</Text>
      <Text style={styles.distLabel}>{label}</Text>
      <Text style={styles.distSubtext}>{pct.toFixed(0)}% of areas</Text>
    </View>
  );

  const ComparisonHeader = ({ nameA, nameB }: { nameA: string; nameB: string }) => (
    <View style={styles.compareHeaderRow}>
      <Text style={[styles.compareCell, styles.compareCellHeader]}>Indicator</Text>
      <Text style={[styles.compareCell, styles.compareCellHeader]} numberOfLines={1}>{nameA}</Text>
      <Text style={[styles.compareCell, styles.compareCellHeader]} numberOfLines={1}>{nameB}</Text>
    </View>
  );

  const ComparisonRow = ({ label, valueA, valueB }: { label: string; valueA: number; valueB: number }) => {
    const higher = valueA > valueB ? "A" : valueB > valueA ? "B" : "tie";
    const a = Number.isFinite(valueA) ? valueA.toFixed(1) : "N/A";
    const b = Number.isFinite(valueB) ? valueB.toFixed(1) : "N/A";
    return (
      <View style={styles.compareDataRow}>
        <Text style={styles.compareCell}>{label}</Text>
        <Text style={[styles.compareCell, styles.compareValue, { color: higher === "A" ? theme.danger : theme.text, fontWeight: higher === "A" ? "900" : "600" }]}>{a}</Text>
        <Text style={[styles.compareCell, styles.compareValue, { color: higher === "B" ? theme.danger : theme.text, fontWeight: higher === "B" ? "900" : "600" }]}>{b}</Text>
      </View>
    );
  };

  const HealthRow = ({ label, high, low }: { label: string; high: string; low: string }) => (
    <View style={styles.healthRow}>
      <Text style={styles.healthCell}>{label}</Text>
      <Text style={[styles.healthCell, styles.healthValue, { color: theme.danger }]}>{high}</Text>
      <Text style={[styles.healthCell, styles.healthValue, { color: theme.success }]}>{low}</Text>
    </View>
  );

  const SearchStat = ({ label, value }: { label: string; value: string }) => (
    <View style={styles.searchStat}>
      <Text style={styles.searchStatLabel}>{label}</Text>
      <Text style={styles.searchStatValue}>{value}</Text>
    </View>
  );

  const DataSource = ({ title, detail }: { title: string; detail: string }) => (
    <View style={styles.sourceRow}>
      <Text style={styles.sourceTitle}>{title}</Text>
      <Text style={styles.sourceDetail}>{detail}</Text>
    </View>
  );

  const [geoData, setGeoData] = useState<any>(null);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [showCompare, setShowCompare] = useState(true);
  const [showMethodology, setShowMethodology] = useState(false);
  const [insightsTab, setInsightsTab] = useState<InsightsTab>("distribution");
  const [insightsSearch, setInsightsSearch] = useState("");
  const [aqs, setAqs] = useState<AqsHistory | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/current-risk-map`);
        if (res.ok) setGeoData(await res.json());
      } catch (err) {
        console.warn("Risk map fetch failed:", err);
      }
      try {
        const res = await fetch(`${API_BASE}/api/aqs-history`);
        if (res.ok) setAqs(await res.json());
      } catch (err) {
        console.warn("AQS fetch failed:", err);
      }
    })();
  }, []);

  const all: FeatureProperties[] = geoData?.features?.map((f: GeoJsonFeature) => f.properties) || [];
  const ranked = useMemo(
    () => [...all].sort((a, b) => getDisplayRiskScore(b) - getDisplayRiskScore(a)),
    [geoData]
  );
  const colorFor = useMemo(
    () => buildQuintileColorFn(ranked.map((p) => getDisplayRiskScore(p))),
    [ranked]
  );

  const top10 = ranked.slice(0, 10);
  const top10Max = top10[0] ? getDisplayRiskScore(top10[0]) : 100;
  const areaA = all.find((n) => getCommunity(n).toLowerCase() === compareA.toLowerCase());
  const areaB = all.find((n) => getCommunity(n).toLowerCase() === compareB.toLowerCase());

  const totalForDist = ranked.length || 1;
  const lowCount = ranked.filter((a) => getDisplayRiskScore(a) < 40).length;
  const medCount = ranked.filter((a) => {
    const s = getDisplayRiskScore(a);
    return s >= 40 && s < 70;
  }).length;
  const highCount = ranked.filter((a) => getDisplayRiskScore(a) >= 70).length;
  const lowPct = (lowCount / totalForDist) * 100;
  const medPct = (medCount / totalForDist) * 100;
  const highPct = (highCount / totalForDist) * 100;

  const insightSearchMatches =
    insightsSearch.length > 0
      ? ranked.filter((a) => getCommunity(a).toLowerCase().includes(insightsSearch.toLowerCase())).slice(0, 5)
      : [];

  const highRiskAreas = ranked.filter((a) => getDisplayRiskScore(a) >= 70);
  const lowRiskAreas = ranked.filter((a) => getDisplayRiskScore(a) < 40);
  const avgArr = (arr: any[], fn: (a: any) => number) => {
    const vals = arr.map(fn).filter(Number.isFinite);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : NaN;
  };
  const highPoverty = avgArr(highRiskAreas, getPoverty);
  const lowPoverty = avgArr(lowRiskAreas, getPoverty);
  const highUnemp = avgArr(highRiskAreas, getUnemployment);
  const lowUnemp = avgArr(lowRiskAreas, getUnemployment);
  const highIncome = avgArr(highRiskAreas, getIncome);
  const lowIncome = avgArr(lowRiskAreas, getIncome);

  const withData = ranked.filter((a) => Number.isFinite(getPoverty(a)));
  const highPovHighRisk = withData.filter((a) => getPoverty(a) >= 20 && getDisplayRiskScore(a) >= 60).length;
  const lowPovLowRisk = withData.filter((a) => getPoverty(a) < 10 && getDisplayRiskScore(a) < 40).length;
  const sortedByRisk = [...withData].sort((a, b) => getDisplayRiskScore(b) - getDisplayRiskScore(a));
  const top10AvgPoverty = (() => {
    const top = sortedByRisk.slice(0, 10);
    const vals = top.map(getPoverty).filter(Number.isFinite);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  })();
  const bottom10AvgPoverty = (() => {
    const bot = sortedByRisk.slice(-10);
    const vals = bot.map(getPoverty).filter(Number.isFinite);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  })();
  const povertyGap = top10AvgPoverty - bottom10AvgPoverty;

  return (
    <ScrollView style={sharedStyles.page}>
      <View style={sharedStyles.hero}>
        <Text style={sharedStyles.heroTitle}>Analyze</Text>
        <Text style={sharedStyles.heroSubtitle}>Rankings · comparisons · environmental justice</Text>
        <Text style={sharedStyles.heroDescription}>
          Deep dive into Chicago's environmental risk patterns, neighborhood comparisons, and the link between pollution and poverty.
        </Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Top 10 Highest-Risk Neighborhoods</Text>
        <Text style={sharedStyles.cardSubtitle}>
          Composite environmental risk score across all 77 Chicago community areas.
        </Text>
        {top10.length === 0 && <Text style={sharedStyles.bodyText}>Loading rankings…</Text>}
        {top10.map((item, i) => {
          const score = getDisplayRiskScore(item);
          const width = (score / top10Max) * 100;
          return (
            <View key={getCommunity(item)} style={styles.rankRow}>
              <Text style={styles.rankNum}>#{i + 1}</Text>
              <Text style={styles.rankName} numberOfLines={1}>{getCommunity(item)}</Text>
              <View style={styles.rankBarContainer}>
                <View style={[styles.rankBar, { width: `${width}%`, backgroundColor: colorFor(score) }]} />
                <Text style={styles.rankScore}>{score.toFixed(1)}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Historical Air Pollution (Cook County)</Text>
        <Text style={sharedStyles.cardSubtitle}>
          Monthly mean concentrations from EPA's Air Quality System (AQS) ground monitors over the last 12 months.
        </Text>
        {!aqs && <Text style={sharedStyles.bodyText}>Loading EPA AQS data…</Text>}
        {aqs && !aqs.available && (
          <View style={styles.aqsUnavailable}>
            <Text style={styles.aqsUnavailableText}>{aqs.message || "Not available"}</Text>
            <Text style={sharedStyles.cardSubtitle}>
              Add AQS_EMAIL and AQS_KEY to the backend env. Free registration at https://aqs.epa.gov/data/api/signup.
            </Text>
          </View>
        )}
        {aqs?.available && aqs.series && (
          <View>
            {Object.entries(aqs.series).map(([pollutant, points]) => {
              if (!points || points.length === 0) return null;
              const max = Math.max(...points.map((p) => p.mean));
              const unit = points[0]?.unit || "";
              return (
                <View key={pollutant} style={styles.aqsRow}>
                  <View style={styles.aqsRowHeader}>
                    <Text style={styles.aqsPollutant}>{pollutant}</Text>
                    <Text style={styles.aqsUnit}>{unit}</Text>
                  </View>
                  <View style={styles.aqsChart}>
                    {points.map((p) => {
                      const h = max > 0 ? (p.mean / max) * 100 : 0;
                      return (
                        <View key={p.month} style={styles.aqsBarColumn}>
                          <View style={[styles.aqsBar, { height: `${h}%` }]} />
                          <Text style={styles.aqsMonth}>{p.month.slice(5)}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View style={sharedStyles.card}>
        <View style={styles.sectionHeader}>
          <Text style={sharedStyles.cardTitle}>Compare Two Neighborhoods</Text>
          <Pressable onPress={() => setShowCompare(!showCompare)} style={styles.toggleButtonSmall}>
            <Text style={styles.toggleButtonTextSmall}>{showCompare ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>
        {showCompare && (
          <>
            <Text style={sharedStyles.cardSubtitle}>Side-by-side metrics.</Text>
            <View style={styles.compareInputs}>
              <TextInput
                style={styles.compareInput}
                placeholder="First area (e.g. Englewood)"
                placeholderTextColor="#9ca3af"
                value={compareA}
                onChangeText={setCompareA}
              />
              <TextInput
                style={styles.compareInput}
                placeholder="Second area (e.g. Lincoln Park)"
                placeholderTextColor="#9ca3af"
                value={compareB}
                onChangeText={setCompareB}
              />
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

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Chicago Insights</Text>
        <View style={styles.insightsTabRow}>
          {(["distribution", "search", "health", "ej"] as InsightsTab[]).map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setInsightsTab(tab)}
              style={[styles.insightsTab, insightsTab === tab && styles.insightsTabActive]}
            >
              <Text style={[styles.insightsTabText, insightsTab === tab && styles.insightsTabTextActive]}>
                {tab === "distribution" && "📊 Distribution"}
                {tab === "search" && "🔍 Search"}
                {tab === "health" && "🏥 Health"}
                {tab === "ej" && "⚖️ Equity"}
              </Text>
            </Pressable>
          ))}
        </View>

        {insightsTab === "distribution" && (
          <View style={{ marginTop: 14 }}>
            <Text style={sharedStyles.bodyText}>
              Of Chicago's {totalForDist} community areas, here's how risk is distributed:
            </Text>
            <View style={styles.distRow}>
              <DistCard count={lowCount} pct={lowPct} label="Low Risk" color="#2e7d32" />
              <DistCard count={medCount} pct={medPct} label="Medium Risk" color="#fb8c00" />
              <DistCard count={highCount} pct={highPct} label="High Risk" color="#c62828" />
            </View>
            <View style={styles.distBarTrack}>
              <View style={[styles.distBarSeg, { width: `${lowPct}%`, backgroundColor: "#2e7d32" }]} />
              <View style={[styles.distBarSeg, { width: `${medPct}%`, backgroundColor: "#fb8c00" }]} />
              <View style={[styles.distBarSeg, { width: `${highPct}%`, backgroundColor: "#c62828" }]} />
            </View>
            <Text style={styles.insightCaption}>
              Composite score combines satellite air quality, heat exposure, green space, and socioeconomic vulnerability.
            </Text>
          </View>
        )}

        {insightsTab === "search" && (
          <View style={{ marginTop: 14 }}>
            <TextInput
              style={styles.insightsSearchInput}
              placeholder="Type a neighborhood name (e.g. Englewood, Lincoln Park)"
              placeholderTextColor="#9ca3af"
              value={insightsSearch}
              onChangeText={setInsightsSearch}
            />
            {insightsSearch.length > 0 && insightSearchMatches.length === 0 && (
              <Text style={sharedStyles.bodyText}>No matches for "{insightsSearch}"</Text>
            )}
            {insightSearchMatches.map((area) => {
              const score = getDisplayRiskScore(area);
              const rank = ranked.findIndex((a) => getCommunity(a) === getCommunity(area)) + 1;
              return (
                <View key={getCommunity(area)} style={styles.searchResultCard}>
                  <View style={styles.searchResultHeader}>
                    <Text style={styles.searchResultName}>{getCommunity(area)}</Text>
                    <Text style={[styles.searchResultScore, { color: colorFor(score) }]}>{score.toFixed(1)}</Text>
                  </View>
                  <Text style={styles.searchResultMeta}>
                    Ranked #{rank} of {ranked.length} · {getRiskLevel(score)}
                  </Text>
                  <View style={styles.searchResultStats}>
                    <SearchStat label="Air Pollution" value={getSatelliteAirPollutionScore(area).toFixed(0)} />
                    <SearchStat label="Heat" value={getHeatRisk(area).toFixed(0)} />
                    <SearchStat label="Green Space" value={getGreenRisk(area).toFixed(0)} />
                    {Number.isFinite(getPoverty(area)) && (
                      <SearchStat label="Poverty" value={`${getPoverty(area).toFixed(0)}%`} />
                    )}
                  </View>
                </View>
              );
            })}
            {insightsSearch.length === 0 && (
              <Text style={styles.insightCaption}>
                Start typing to find a neighborhood and see its environmental + socioeconomic snapshot.
              </Text>
            )}
          </View>
        )}

        {insightsTab === "health" && (
          <View style={{ marginTop: 14 }}>
            <Text style={sharedStyles.bodyText}>
              Health and socioeconomic patterns across high-risk vs low-risk neighborhoods:
            </Text>
            <View style={styles.healthGrid}>
              <View style={styles.healthHeaderRow}>
                <Text style={[styles.healthCell, styles.healthCellHeader]}>Indicator</Text>
                <Text style={[styles.healthCell, styles.healthCellHeader, { color: "#c62828" }]}>High Risk</Text>
                <Text style={[styles.healthCell, styles.healthCellHeader, { color: "#2e7d32" }]}>Low Risk</Text>
              </View>
              <HealthRow label="Avg Poverty Rate" high={`${highPoverty.toFixed(1)}%`} low={`${lowPoverty.toFixed(1)}%`} />
              <HealthRow label="Avg Unemployment" high={`${highUnemp.toFixed(1)}%`} low={`${lowUnemp.toFixed(1)}%`} />
              <HealthRow
                label="Avg Income"
                high={`$${Math.round(highIncome).toLocaleString()}`}
                low={`$${Math.round(lowIncome).toLocaleString()}`}
              />
              <HealthRow label="# Areas" high={highRiskAreas.length.toString()} low={lowRiskAreas.length.toString()} />
            </View>
            <Text style={styles.insightCaption}>
              People in high-risk environmental areas typically face more poverty, higher unemployment, and lower incomes — a pattern of environmental injustice that EPA recognizes nationally.
            </Text>
          </View>
        )}

        {insightsTab === "ej" && (
          <View style={{ marginTop: 14 }}>
            <Text style={sharedStyles.bodyText}>
              Environmental justice: are pollution burdens distributed fairly?
            </Text>
            <View style={styles.ejStatRow}>
              <Text style={styles.ejStatValue}>{highPovHighRisk}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.ejStatLabel}>High-poverty + High-risk neighborhoods</Text>
                <Text style={styles.ejStatDetail}>
                  Areas where 20%+ live in poverty AND face elevated environmental risk
                </Text>
              </View>
            </View>
            <View style={styles.ejStatRow}>
              <Text style={[styles.ejStatValue, { color: "#2e7d32" }]}>{lowPovLowRisk}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.ejStatLabel}>Affluent + Clean neighborhoods</Text>
                <Text style={styles.ejStatDetail}>
                  Areas with under 10% poverty AND low environmental risk
                </Text>
              </View>
            </View>
            <View style={styles.ejHighlight}>
              <Text style={styles.ejHighlightLabel}>Poverty Gap</Text>
              <Text style={styles.ejHighlightValue}>{povertyGap.toFixed(1)} percentage points</Text>
              <Text style={styles.ejHighlightDetail}>
                Avg poverty in 10 most polluted areas ({top10AvgPoverty.toFixed(1)}%) vs 10 cleanest ({bottom10AvgPoverty.toFixed(1)}%).
              </Text>
            </View>
            <Text style={styles.insightCaption}>
              A large gap signals environmental burdens fall disproportionately on lower-income communities.
            </Text>
          </View>
        )}
      </View>

      <View style={sharedStyles.card}>
        <View style={styles.sectionHeader}>
          <Text style={sharedStyles.cardTitle}>Methodology & Data Sources</Text>
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
            <DataSource title="EPA Superfund NPL + SEMS" detail="Federally-tracked contaminated sites" />
            <DataSource title="Chicago Public Health Statistics" detail="data.cityofchicago.org (iqnk-2tcu)" />
            <DataSource title="Open-Meteo" detail="Weather + forecast (free, no API key)" />
            <DataSource title="Esri World Imagery" detail="Satellite basemap" />
            <DataSource title="OpenStreetMap Nominatim" detail="Address geocoding" />
          </>
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

const createStyles = (t: ThemeTokens) => StyleSheet.create({
  rankRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border },
  rankNum: { width: 36, fontWeight: "900", color: t.brand, fontSize: 13 },
  rankName: { width: 140, fontWeight: "700", color: t.text, fontSize: 13 },
  rankBarContainer: { flex: 1, height: 24, backgroundColor: t.border, borderRadius: 6, overflow: "hidden", justifyContent: "center", position: "relative" },
  rankBar: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 6 },
  rankScore: { position: "absolute", right: 8, fontWeight: "900", color: t.text, fontSize: 12 },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  toggleButtonSmall: { backgroundColor: t.brand, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  toggleButtonTextSmall: { color: "white", fontWeight: "800", fontSize: 12 },

  compareInputs: { gap: 10, marginTop: 12, marginBottom: 16 },
  compareInput: { padding: 12, borderWidth: 1, borderColor: t.inputBorder, borderRadius: 10, backgroundColor: t.inputBg, fontSize: 14, color: t.text },
  compareGrid: { borderWidth: 1, borderColor: t.borderStrong, borderRadius: 12, overflow: "hidden" },
  compareHeaderRow: { flexDirection: "row", backgroundColor: t.brandTint, paddingVertical: 10 },
  compareDataRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: t.borderStrong, paddingVertical: 10 },
  compareCell: { flex: 1, paddingHorizontal: 10, fontSize: 13, color: t.text },
  compareCellHeader: { fontWeight: "800", color: t.brand, textTransform: "uppercase", fontSize: 11, letterSpacing: 0.5 },
  compareValue: { textAlign: "right", fontVariant: ["tabular-nums"] },

  insightsTabRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  insightsTab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: t.border },
  insightsTabActive: { backgroundColor: t.brand },
  insightsTabText: { fontSize: 13, fontWeight: "700", color: t.text },
  insightsTabTextActive: { color: "white" },

  distRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  distCard: { flex: 1, backgroundColor: t.cardElevated, padding: 14, borderRadius: 10, alignItems: "center" },
  distValue: { fontSize: 30, fontWeight: "900", lineHeight: 34 },
  distLabel: { fontSize: 12, fontWeight: "700", color: t.text, marginTop: 4 },
  distSubtext: { fontSize: 11, color: t.textMuted, marginTop: 2 },
  distBarTrack: { flexDirection: "row", height: 12, borderRadius: 999, overflow: "hidden", marginTop: 14, backgroundColor: t.border },
  distBarSeg: { height: "100%" },
  insightCaption: { fontSize: 12, color: t.textMuted, marginTop: 12, lineHeight: 18, fontStyle: "italic" },

  insightsSearchInput: { padding: 12, borderWidth: 1, borderColor: t.inputBorder, borderRadius: 10, backgroundColor: t.inputBg, fontSize: 14, marginBottom: 12, color: t.text },
  searchResultCard: { backgroundColor: t.cardElevated, padding: 14, borderRadius: 10, marginBottom: 8 },
  searchResultHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  searchResultName: { fontWeight: "800", color: t.text, fontSize: 15 },
  searchResultScore: { fontWeight: "900", fontSize: 22 },
  searchResultMeta: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  searchResultStats: { flexDirection: "row", gap: 14, marginTop: 10 },
  searchStat: { flex: 1 },
  searchStatLabel: { fontSize: 10, fontWeight: "700", color: t.textMuted, textTransform: "uppercase", letterSpacing: 0.4 },
  searchStatValue: { fontSize: 16, fontWeight: "900", color: t.text, marginTop: 2 },

  healthGrid: { borderWidth: 1, borderColor: t.borderStrong, borderRadius: 12, overflow: "hidden", marginTop: 14 },
  healthHeaderRow: { flexDirection: "row", backgroundColor: t.brandTint, paddingVertical: 10 },
  healthRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: t.borderStrong, paddingVertical: 10 },
  healthCell: { flex: 1, paddingHorizontal: 10, fontSize: 13, color: t.text },
  healthCellHeader: { fontWeight: "800", textTransform: "uppercase", fontSize: 11, letterSpacing: 0.5 },
  healthValue: { textAlign: "right", fontWeight: "800", fontVariant: ["tabular-nums"] },

  ejStatRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.border },
  ejStatValue: { fontSize: 36, fontWeight: "900", color: t.danger, width: 60, textAlign: "center" },
  ejStatLabel: { fontWeight: "800", color: t.text, fontSize: 14 },
  ejStatDetail: { fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 17 },
  ejHighlight: { backgroundColor: t.name === "dark" ? "#3a2c0a" : "#fff3cd", padding: 14, borderRadius: 10, marginTop: 14, borderLeftWidth: 4, borderLeftColor: t.warning },
  ejHighlightLabel: { fontSize: 11, fontWeight: "800", color: t.name === "dark" ? "#fcd34d" : "#92400e", textTransform: "uppercase", letterSpacing: 0.5 },
  ejHighlightValue: { fontSize: 24, fontWeight: "900", color: t.name === "dark" ? "#fcd34d" : "#92400e", marginTop: 4 },
  ejHighlightDetail: { fontSize: 12, color: t.name === "dark" ? "#fcd34d" : "#92400e", marginTop: 4, lineHeight: 17 },

  formula: { backgroundColor: t.cardElevated, padding: 12, borderRadius: 8, fontSize: 13, fontWeight: "700", color: t.brand, fontVariant: ["tabular-nums"] },
  sourceRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border },
  sourceTitle: { fontSize: 14, fontWeight: "800", color: t.brand },
  sourceDetail: { fontSize: 12, color: t.textMuted, marginTop: 2 },

  aqsUnavailable: { padding: 14, backgroundColor: t.name === "dark" ? "#3a2c0a" : "#fef3c7", borderRadius: 10, borderLeftWidth: 4, borderLeftColor: t.warning },
  aqsUnavailableText: { fontWeight: "700", color: t.name === "dark" ? "#fcd34d" : "#92400e", marginBottom: 4 },
  aqsRow: { marginTop: 14 },
  aqsRowHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  aqsPollutant: { fontWeight: "800", color: t.text, fontSize: 14 },
  aqsUnit: { fontSize: 11, color: t.textMuted, fontWeight: "600" },
  aqsChart: { flexDirection: "row", alignItems: "flex-end", height: 100, gap: 2, backgroundColor: t.cardElevated, padding: 8, borderRadius: 8 },
  aqsBarColumn: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  aqsBar: { width: "80%", backgroundColor: "#075f43", borderRadius: 2, minHeight: 2 },
  aqsMonth: { fontSize: 9, color: "#6b7280", marginTop: 2, fontWeight: "600" },
});

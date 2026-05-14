import geopandas as gpd
import pandas as pd


# -----------------------------
# File paths
# -----------------------------

BOUNDARIES_PATH = "../data/raw/Boundaries_-_Community_Areas_20260512.geojson"
OPEN_AIR_PATH = "../data/raw/Open_Air_Chicago_Day_Aggregations_20260512.geojson"
ACS_PATH = "../data/raw/ACS_5_Year_Data_by_Community_Area_20260512.csv"

OUTPUT_PATH = "../data/processed/neighborhood_risk_scores.csv"


# -----------------------------
# Helper functions
# -----------------------------

def clean_number(value):
    """
    Converts values like '1,269' into 1269.
    If the value is missing, return 0.
    """
    if pd.isna(value):
        return 0

    return float(str(value).replace(",", "").replace("$", "").strip())


def normalize_column(series):
    """
    Converts a column to a 0-100 scale.
    Lowest value becomes 0.
    Highest value becomes 100.
    """
    minimum = series.min()
    maximum = series.max()

    if maximum == minimum:
        return series * 0

    return ((series - minimum) / (maximum - minimum)) * 100


def get_risk_level(score):
    """
    Converts a number score into a plain-English label.
    """
    if score <= 20:
        return "Very Low Risk"
    elif score <= 40:
        return "Low Risk"
    elif score <= 60:
        return "Moderate Risk"
    elif score <= 80:
        return "High Risk"
    else:
        return "Very High Risk"


def make_summary(row):
    """
    Creates a simple explanation for the app.
    """
    return (
        f"{row['community_area']} has an environmental risk score of "
        f"{row['final_risk_score']}/100. This score is based on measured air "
        f"pollution and household income vulnerability from public datasets."
    )


# -----------------------------
# Load data
# -----------------------------

print("Loading boundary file...")
boundaries = gpd.read_file(BOUNDARIES_PATH)

print("Loading Open Air Chicago file...")
open_air = gpd.read_file(OPEN_AIR_PATH)

print("Loading ACS file...")
acs = pd.read_csv(ACS_PATH)


# -----------------------------
# Prepare boundaries
# -----------------------------

boundaries = boundaries[["area_numbe", "community", "geometry"]].copy()

boundaries["community"] = boundaries["community"].str.upper().str.strip()


# -----------------------------
# Prepare Open Air pollution data
# -----------------------------

open_air = open_air[
    [
        "sensor_name",
        "no2conc24hourmean_value",
       "pm2_5concmass24hourmean_value",
        "latitude",
        "longitude",
        "geometry",
    ]
].copy()

open_air["no2"] = open_air["no2conc24hourmean_value"].apply(clean_number)
open_air["pm25"] = open_air["pm2_5concmass24hourmean_value"].apply(clean_number)

# Make sure both map files use the same coordinate system
open_air = open_air.set_crs(boundaries.crs, allow_override=True)

# Match each sensor reading to a community area
print("Matching air sensors to community areas...")
air_with_community = gpd.sjoin(
    open_air,
    boundaries,
    how="inner",
    predicate="within"
)

# Average pollution by community area
air_summary = (
    air_with_community
    .groupby("community")
    .agg(
        avg_no2=("no2", "mean"),
        avg_pm25=("pm25", "mean"),
        sensor_reading_count=("sensor_name", "count")
    )
    .reset_index()
)

air_summary["avg_no2"] = air_summary["avg_no2"].round(2)
air_summary["avg_pm25"] = air_summary["avg_pm25"].round(2)

# Create air pollution score
air_summary["no2_score"] = normalize_column(air_summary["avg_no2"])
air_summary["pm25_score"] = normalize_column(air_summary["avg_pm25"])

air_summary["air_pollution_score"] = (
    0.5 * air_summary["no2_score"] +
    0.5 * air_summary["pm25_score"]
).round(2)


# -----------------------------
# Prepare ACS socioeconomic data
# -----------------------------

acs = acs.copy()

acs["community"] = acs["Community Area"].str.upper().str.strip()

acs["under_25000"] = acs["Under $25,000"].apply(clean_number)
acs["total_population"] = acs["Total Population"].apply(clean_number)

# Avoid divide-by-zero
acs["low_income_rate"] = acs.apply(
    lambda row: row["under_25000"] / row["total_population"]
    if row["total_population"] > 0
    else 0,
    axis=1
)

acs["socioeconomic_score"] = normalize_column(acs["low_income_rate"]).round(2)

acs_summary = acs[
    [
        "community",
        "under_25000",
        "total_population",
        "low_income_rate",
        "socioeconomic_score",
    ]
].copy()


# -----------------------------
# Combine air + ACS
# -----------------------------

print("Combining pollution and ACS data...")
combined = pd.merge(
    air_summary,
    acs_summary,
    on="community",
    how="outer"
)

# Fill missing scores with 0 for now
combined["air_pollution_score"] = combined["air_pollution_score"].fillna(0)
combined["socioeconomic_score"] = combined["socioeconomic_score"].fillna(0)

# First real MVP formula:
# 70% air pollution + 30% socioeconomic vulnerability
combined["final_risk_score"] = (
    0.70 * combined["air_pollution_score"] +
    0.30 * combined["socioeconomic_score"]
).round(2)

combined["risk_level"] = combined["final_risk_score"].apply(get_risk_level)

combined = combined.rename(columns={
    "community": "community_area"
})

combined["summary"] = combined.apply(make_summary, axis=1)

# Sort from highest risk to lowest risk
combined = combined.sort_values("final_risk_score", ascending=False)


# -----------------------------
# Save output
# -----------------------------

print("Saving final risk score file...")
combined.to_csv(OUTPUT_PATH, index=False)

print("Done.")
print(f"Created file: {OUTPUT_PATH}")

print("\nTOP 10 HIGHEST RISK AREAS:")
print(combined[[
    "community_area",
    "final_risk_score",
    "risk_level",
    "air_pollution_score",
    "socioeconomic_score"
]].head(10))
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import time
import os
import ee
import urllib.request
import urllib.parse

app = FastAPI(title="EnviroSight Chicago API", version="1.6.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

EE_PROJECT = "envirosight-496315"
CHICAGO_ASSET = "projects/envirosight-496315/assets/chicago_risk_map"

CACHE_SECONDS = 60 * 60 * 24
cached_geojson = None
cached_at = 0

AIRNOW_API_KEY = os.environ.get("AIRNOW_API_KEY", "679BF6FA-7F0D-4C63-BD5B-A556E7EEFCF9")
AIRNOW_CACHE_SECONDS = 15 * 60
CHICAGO_BBOX = "-88.0,41.6,-87.5,42.05"
CHICAGO_LAT = 41.8781
CHICAGO_LNG = -87.6298

airnow_stations_cache = None
airnow_stations_cached_at = 0
airnow_summary_cache = None
airnow_summary_cached_at = 0

TRI_CACHE_SECONDS = 60 * 60 * 24 * 7
tri_cache = None
tri_cached_at = 0

SUPERFUND_CACHE_SECONDS = 60 * 60 * 24 * 7
superfund_cache = None
superfund_cached_at = 0

PH_CACHE_SECONDS = 60 * 60 * 24 * 30
public_health_cache = None
public_health_cached_at = 0

# Weather cache — 10 minutes
WEATHER_CACHE_SECONDS = 10 * 60
weather_cache = None
weather_cached_at = 0

BACKUP_GEOJSON_PATH = (
    Path(__file__).resolve().parent.parent
    / "mobile app" / "envirosight-mobile" / "public" / "data" / "chicago_risk_map.geojson"
)

ORIGINAL_RISK_KEYS = ["new_risk_s", "new_risk_score", "risk_score", "risk_scor", "new_risk", "risk"]

CHICAGO_SUPERFUND_SITES = [
    {"id": "ILN000509241", "name": "ACME STEEL COKE PLANT", "zip": "60617", "status": "Final NPL", "latitude": 41.7195, "longitude": -87.5855},
    {"id": "ILD000716852", "name": "LAKE CALUMET CLUSTER", "zip": "60633", "status": "Final NPL", "latitude": 41.6892, "longitude": -87.5321},
    {"id": "ILN000510192", "name": "PEOPLES GAS CRAWFORD STATION FORMER MGP", "zip": "60623", "status": "Non-NPL", "latitude": 41.8534, "longitude": -87.7154},
    {"id": "ILD982074767", "name": "PEOPLES GAS LIGHT & COKE - 22ND ST", "zip": "60608", "status": "Non-NPL", "latitude": 41.8478, "longitude": -87.6553},
    {"id": "ILD982074783", "name": "PEOPLES GAS LIGHT & COKE - DIVISION ST", "zip": "60642", "status": "Non-NPL", "latitude": 41.9031, "longitude": -87.6553},
    {"id": "ILD982074775", "name": "PEOPLES GAS LIGHT & COKE NORTH STA", "zip": "60610", "status": "Non-NPL", "latitude": 41.8985, "longitude": -87.6359},
    {"id": "ILD982074759", "name": "PEOPLES GAS LIGHT & COKE WILLOW ST STATION", "zip": "60614", "status": "Non-NPL", "latitude": 41.9214, "longitude": -87.6512},
    {"id": "ILN000510193", "name": "PEOPLES GAS NORTH SHORE AVENUE STATION FORMER MGP", "zip": "60645", "status": "Non-NPL", "latitude": 41.9998, "longitude": -87.6721},
    {"id": "ILN000510191", "name": "PEOPLES GAS SOUTH STATION FORMER MGP", "zip": "60608", "status": "Non-NPL", "latitude": 41.8456, "longitude": -87.6489},
    {"id": "ILN000510194", "name": "PEOPLES GAS THROOP STREET FORMER MGP", "zip": "60608", "status": "Non-NPL", "latitude": 41.8501, "longitude": -87.6578},
    {"id": "ILN000505540", "name": "SCHROUD PROPERTY", "zip": "60633", "status": "Final NPL", "latitude": 41.6823, "longitude": -87.5298},
]


def initialize_earth_engine() -> tuple[bool, str]:
    try:
        sa_json = os.environ.get("EE_SERVICE_ACCOUNT_JSON")
        sa_file = os.environ.get("EE_SERVICE_ACCOUNT_FILE", "service-account.json")
        if sa_json:
            import tempfile
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
                f.write(sa_json)
                temp_path = f.name
            credentials = ee.ServiceAccountCredentials(None, temp_path)
            ee.Initialize(credentials, project=EE_PROJECT)
            ee.Number(1).getInfo()
            print("[EE] Initialized via service account (env JSON).")
            return True, "ok (service account)"
        elif os.path.exists(sa_file):
            credentials = ee.ServiceAccountCredentials(None, sa_file)
            ee.Initialize(credentials, project=EE_PROJECT)
            ee.Number(1).getInfo()
            print(f"[EE] Initialized via service account file: {sa_file}")
            return True, "ok (service account file)"
        else:
            ee.Initialize(project=EE_PROJECT)
            ee.Number(1).getInfo()
            print("[EE] Initialized via user auth.")
            return True, "ok (user auth)"
    except ee.EEException as error:
        msg = str(error)
        if "not authenticated" in msg.lower() or "credentials" in msg.lower():
            return False, "No credentials. Run: earthengine authenticate"
        return False, f"EE error: {msg}"
    except Exception as error:
        return False, f"Unexpected error: {error}"


EARTH_ENGINE_READY, EE_INIT_MESSAGE = initialize_earth_engine()


def date_string(days_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%d")


def get_community_name(properties: dict) -> str:
    for key in ["community", "COMMUNITY", "community_area", "community_n", "name", "NAME"]:
        value = properties.get(key)
        if value:
            return str(value)
    return "Unknown"


def normalize_name(s: str) -> str:
    if not s:
        return ""
    return "".join(c for c in str(s).lower() if c.isalnum())


def get_number(properties: dict, possible_keys: list[str], default: float = 0.0) -> float:
    for key in possible_keys:
        value = properties.get(key)
        if value is not None and value != "":
            try:
                return float(value)
            except Exception:
                pass
    return default


def http_get_json(url: str, timeout: int = 30):
    req = urllib.request.Request(url, headers={"User-Agent": "EnviroSight-Chicago/1.6"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_backup_geojson():
    if not BACKUP_GEOJSON_PATH.exists():
        raise HTTPException(status_code=404, detail=f"Backup not found at {BACKUP_GEOJSON_PATH}")
    with open(BACKUP_GEOJSON_PATH, "r", encoding="utf-8") as file:
        return json.load(file)


def normalize_features(features, input_field, output_field, reverse=False):
    values = []
    for f in features:
        v = f["properties"].get(input_field)
        if v is not None:
            try:
                values.append(float(v))
            except Exception:
                pass
    if not values:
        for f in features:
            f["properties"][output_field] = 0
        return
    min_v, max_v = min(values), max(values)
    rng = max_v - min_v
    for f in features:
        raw = f["properties"].get(input_field)
        if raw is None or rng == 0:
            score = 0
        else:
            try:
                score = ((float(raw) - min_v) / rng) * 100
            except Exception:
                score = 0
        if reverse:
            score = 100 - score
        f["properties"][output_field] = round(score, 1)


def reduce_image_by_community(image, band_name, scale):
    chicago_areas = ee.FeatureCollection(CHICAGO_ASSET)
    stats = image.select(band_name).reduceRegions(
        collection=chicago_areas, reducer=ee.Reducer.mean(), scale=scale
    )
    result = stats.getInfo()
    values = {}
    for f in result.get("features", []):
        props = f.get("properties", {})
        community = get_community_name(props)
        value = props.get("mean")
        if value is not None:
            try:
                values[community] = float(value)
            except Exception:
                values[community] = None
        else:
            values[community] = None
    return values


def safe_reduce(image_fn, band_name, scale, label):
    """Run a satellite reduction safely. Returns {} if it fails."""
    try:
        image = image_fn()
        return reduce_image_by_community(image, band_name, scale)
    except Exception as e:
        print(f"[EE] Layer '{label}' failed: {e}. Skipping.")
        return {}


PUBLIC_HEALTH_URL = "https://data.cityofchicago.org/resource/iqnk-2tcu.json"


def fetch_public_health() -> dict:
    raw = http_get_json(PUBLIC_HEALTH_URL, timeout=45)
    result = {}
    for row in raw:
        name = row.get("community_area_name") or row.get("community_area") or ""
        if not name:
            continue
        key = normalize_name(name)
        cleaned = {}
        for k, v in row.items():
            if v is None or v == "":
                continue
            try:
                cleaned[k] = float(v)
            except Exception:
                cleaned[k] = v
        cleaned["_display_name"] = name
        result[key] = cleaned
    return result


def compute_ses_vulnerability(ph_row: dict) -> float:
    poverty = ph_row.get("below_poverty_level")
    unemployment = ph_row.get("unemployment")
    no_hs = ph_row.get("no_high_school_diploma")
    crowded = ph_row.get("crowded_housing")
    components = []
    if isinstance(poverty, (int, float)): components.append(min(poverty, 100))
    if isinstance(unemployment, (int, float)): components.append(min(unemployment * 2, 100))
    if isinstance(no_hs, (int, float)): components.append(min(no_hs, 100))
    if isinstance(crowded, (int, float)): components.append(min(crowded * 4, 100))
    if not components:
        return -1
    return sum(components) / len(components)


def get_public_health_cached() -> dict:
    global public_health_cache, public_health_cached_at
    now = time.time()
    if public_health_cache is not None and now - public_health_cached_at < PH_CACHE_SECONDS:
        return public_health_cache
    data = fetch_public_health()
    public_health_cache = data
    public_health_cached_at = now
    return data


def build_current_geojson():
    if not EARTH_ENGINE_READY:
        raise RuntimeError("Earth Engine not initialized.")
    chicago_areas = ee.FeatureCollection(CHICAGO_ASSET)
    today = date_string(0)
    start_14 = date_string(14)
    start_30 = date_string(30)
    start_60 = date_string(60)
    start_90 = date_string(90)

    def mask_s2(image):
        scl = image.select("SCL")
        return image.updateMask(scl.neq(3).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10)).And(scl.neq(11)))

    def mask_landsat(image):
        qa = image.select("QA_PIXEL")
        return image.updateMask(qa.bitwiseAnd(1 << 3).eq(0)).updateMask(qa.bitwiseAnd(1 << 4).eq(0)).updateMask(qa.bitwiseAnd(1 << 5).eq(0))

    def mask_cf(image):
        return image.updateMask(image.select("cloud_fraction").lte(0.3))

    def make_ndvi():
        sentinel = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(chicago_areas).filterDate(start_60, today)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 40)).map(mask_s2)
            .map(lambda i: i.addBands(i.normalizedDifference(["B8", "B4"]).rename("NDVI"))))
        return sentinel.select("NDVI").median().rename("NDVI")

    def make_lst():
        landsat = (ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
            .filterBounds(chicago_areas).filterDate(start_90, today).map(mask_landsat)
            .map(lambda i: i.addBands(i.select("ST_B10").multiply(0.00341802).add(149.0).subtract(273.15).rename("LST_C"))))
        return landsat.select("LST_C").median().rename("LST_C")

    def make_no2():
        return (ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_NO2").filterBounds(chicago_areas).filterDate(start_14, today).map(mask_cf).select("tropospheric_NO2_column_number_density").mean().rename("NO2"))

    def make_aod():
        # Try newer MODIS dataset first, fall back to MERRA
        try:
            modis = (ee.ImageCollection("MODIS/061/MCD19A2_GRANULES")
                .filterBounds(chicago_areas).filterDate(start_30, today)
                .select("Optical_Depth_055").mean().rename("AOD_PM25_PROXY"))
            return modis
        except Exception:
            return (ee.ImageCollection("NASA/GSFC/MERRA/aer/2")
                .filterBounds(chicago_areas).filterDate(start_30, today)
                .select("TOTEXTTAU").mean().rename("AOD_PM25_PROXY"))

    def make_so2():
        return (ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_SO2").filterBounds(chicago_areas).filterDate(start_30, today).map(mask_cf).select("SO2_column_number_density").mean().rename("SO2"))

    def make_co():
        return (ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_CO").filterBounds(chicago_areas).filterDate(start_30, today).select("CO_column_number_density").mean().rename("CO"))

    def make_o3():
        return (ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_O3").filterBounds(chicago_areas).filterDate(start_30, today).map(mask_cf).select("O3_column_number_density").mean().rename("O3"))

    mean_ndvi = safe_reduce(make_ndvi, "NDVI", 10, "NDVI")
    mean_lst = safe_reduce(make_lst, "LST_C", 30, "LST")
    mean_no2 = safe_reduce(make_no2, "NO2", 1000, "NO2")
    mean_aod = safe_reduce(make_aod, "AOD_PM25_PROXY", 1000, "AOD")
    mean_so2 = safe_reduce(make_so2, "SO2", 1000, "SO2")
    mean_co = safe_reduce(make_co, "CO", 1000, "CO")
    mean_o3 = safe_reduce(make_o3, "O3", 1000, "O3")

    try:
        ph_data = get_public_health_cached()
    except Exception as e:
        print(f"[PH] Fetch failed: {e}")
        ph_data = {}

    base = chicago_areas.getInfo()
    features = base.get("features", [])
    generated_at = datetime.now(timezone.utc).isoformat()

    for f in features:
        props = f.get("properties", {})
        community = get_community_name(props)
        props["mean_ndvi"] = mean_ndvi.get(community)
        props["mean_lst_c"] = mean_lst.get(community)
        props["mean_no2"] = mean_no2.get(community)
        props["mean_aod_pm25_proxy"] = mean_aod.get(community)
        props["mean_so2"] = mean_so2.get(community)
        props["mean_co"] = mean_co.get(community)
        props["mean_o3"] = mean_o3.get(community)
        ph_row = ph_data.get(normalize_name(community))
        if ph_row:
            for k in ["below_poverty_level", "unemployment", "no_high_school_diploma",
                      "per_capita_income", "crowded_housing", "dependency",
                      "infant_mortality_rate", "low_birth_weight", "preterm_births",
                      "teen_birth_rate", "diabetes_related", "lung_cancer", "stroke_cerebrovascular_diseases",
                      "childhood_blood_lead_level_screening", "childhood_lead_poisoning"]:
                if k in ph_row:
                    props[f"ph_{k}"] = ph_row[k]
            ses = compute_ses_vulnerability(ph_row)
            if ses >= 0:
                props["ph_ses_vulnerability_score"] = round(ses, 1)

    normalize_features(features, "mean_ndvi", "green_space_risk_score", reverse=True)
    normalize_features(features, "mean_lst_c", "heat_exposure_score")
    normalize_features(features, "mean_no2", "no2_pollution_score")
    normalize_features(features, "mean_aod_pm25_proxy", "pm25_proxy_pollution_score")
    normalize_features(features, "mean_so2", "so2_pollution_score")
    normalize_features(features, "mean_co", "co_pollution_score")
    normalize_features(features, "mean_o3", "o3_pollution_score")

    for f in features:
        props = f.get("properties", {})
        original_risk = get_number(props, ORIGINAL_RISK_KEYS, 0)
        no2 = get_number(props, ["no2_pollution_score"], 0)
        pm25 = get_number(props, ["pm25_proxy_pollution_score"], 0)
        so2 = get_number(props, ["so2_pollution_score"], 0)
        co = get_number(props, ["co_pollution_score"], 0)
        o3 = get_number(props, ["o3_pollution_score"], 0)
        heat = get_number(props, ["heat_exposure_score"], 0)
        green = get_number(props, ["green_space_risk_score"], 0)
        sat_air = no2 * 0.35 + pm25 * 0.35 + so2 * 0.10 + co * 0.10 + o3 * 0.10
        display = original_risk * 0.70 + sat_air * 0.10 + heat * 0.10 + green * 0.10
        risk_level = "High Risk" if display >= 70 else "Medium Risk" if display >= 40 else "Low Risk"
        props["satellite_air_pollution_score"] = round(sat_air, 1)
        props["display_risk_score"] = round(display, 1)
        props["display_risk_level"] = risk_level
        props["current_readings_generated_at_utc"] = generated_at

    return base


def add_backup_note(geojson):
    try:
        ph_data = get_public_health_cached()
    except Exception:
        ph_data = {}
    for feature in geojson.get("features", []):
        props = feature.get("properties", {})
        original_risk = get_number(props, ORIGINAL_RISK_KEYS, 0)
        air = get_number(props, ["satellite_air_pollution_score"], 0)
        heat = get_number(props, ["heat_exposure_score"], 0)
        green = get_number(props, ["green_space_risk_score"], 0)
        display = original_risk * 0.70 + air * 0.10 + heat * 0.10 + green * 0.10
        risk_level = "High Risk" if display >= 70 else "Medium Risk" if display >= 40 else "Low Risk"
        props["display_risk_score"] = round(display, 1)
        props["display_risk_level"] = risk_level
        props["current_readings_generated_at_utc"] = "Saved file"
        community = get_community_name(props)
        ph_row = ph_data.get(normalize_name(community))
        if ph_row:
            for k in ["below_poverty_level", "unemployment", "no_high_school_diploma",
                      "per_capita_income", "crowded_housing", "dependency",
                      "infant_mortality_rate", "low_birth_weight"]:
                if k in ph_row:
                    props[f"ph_{k}"] = ph_row[k]
            ses = compute_ses_vulnerability(ph_row)
            if ses >= 0:
                props["ph_ses_vulnerability_score"] = round(ses, 1)
    return geojson


def airnow_aqi_color(aqi: float) -> str:
    if aqi <= 50: return "#00e400"
    if aqi <= 100: return "#ffff00"
    if aqi <= 150: return "#ff7e00"
    if aqi <= 200: return "#ff0000"
    if aqi <= 300: return "#8f3f97"
    return "#7e0023"


def airnow_aqi_category(aqi: float) -> str:
    if aqi <= 50: return "Good"
    if aqi <= 100: return "Moderate"
    if aqi <= 150: return "Unhealthy for Sensitive Groups"
    if aqi <= 200: return "Unhealthy"
    if aqi <= 300: return "Very Unhealthy"
    return "Hazardous"


def fetch_airnow_stations():
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=2)
    params = {
        "startDate": start.strftime("%Y-%m-%dT%H"),
        "endDate": end.strftime("%Y-%m-%dT%H"),
        "parameters": "PM25,OZONE,PM10,NO2,SO2,CO",
        "BBOX": CHICAGO_BBOX,
        "dataType": "A", "format": "application/json",
        "verbose": "1", "monitorType": "0", "API_KEY": AIRNOW_API_KEY,
    }
    url = "https://www.airnowapi.org/aq/data/?" + urllib.parse.urlencode(params)
    raw = http_get_json(url)
    stations = {}
    for obs in raw:
        if obs.get("AQI") is None or obs.get("AQI") < 0:
            continue
        key = (round(float(obs["Latitude"]), 4), round(float(obs["Longitude"]), 4))
        if key not in stations:
            stations[key] = {
                "latitude": float(obs["Latitude"]), "longitude": float(obs["Longitude"]),
                "site_name": obs.get("SiteName", "Unknown"),
                "agency": obs.get("AgencyName", ""), "utc_time": obs.get("UTC", ""),
                "readings": {},
            }
        param = obs.get("Parameter", "Unknown")
        aqi = float(obs["AQI"])
        existing = stations[key]["readings"].get(param)
        if existing is None or obs.get("UTC", "") > existing.get("utc", ""):
            stations[key]["readings"][param] = {
                "aqi": aqi, "value": obs.get("Value"),
                "unit": obs.get("Unit", ""), "utc": obs.get("UTC", ""),
            }
    result = []
    for s in stations.values():
        readings = s["readings"]
        if not readings: continue
        worst_param = max(readings.items(), key=lambda kv: kv[1]["aqi"])
        s["worst_aqi"] = worst_param[1]["aqi"]
        s["worst_parameter"] = worst_param[0]
        s["color"] = airnow_aqi_color(s["worst_aqi"])
        s["category"] = airnow_aqi_category(s["worst_aqi"])
        result.append(s)
    return result


def fetch_airnow_summary():
    url = (
        "https://www.airnowapi.org/aq/observation/latLong/current/"
        f"?format=application/json&latitude={CHICAGO_LAT}&longitude={CHICAGO_LNG}"
        f"&distance=25&API_KEY={AIRNOW_API_KEY}"
    )
    raw = http_get_json(url)
    if not raw:
        return {"available": False, "message": "No current readings"}
    by_param = {}
    for obs in raw:
        param = obs.get("ParameterName", "Unknown")
        by_param[param] = {
            "aqi": obs.get("AQI"), "category": obs.get("Category", {}).get("Name", "Unknown"),
            "date": obs.get("DateObserved"), "hour": obs.get("HourObserved"),
            "timezone": obs.get("LocalTimeZone"), "reporting_area": obs.get("ReportingArea"),
        }
    worst = max(by_param.values(), key=lambda x: x["aqi"] or 0)
    return {
        "available": True, "worst_aqi": worst["aqi"], "worst_category": worst["category"],
        "worst_color": airnow_aqi_color(worst["aqi"]),
        "observed_at": f"{worst['date']} {worst['hour']:02d}:00 {worst['timezone']}",
        "reporting_area": worst["reporting_area"], "by_parameter": by_param,
    }


def fetch_tri_facilities():
    url = "https://data.epa.gov/efservice/tri_facility/city_name/=/CHICAGO/state_abbr/=/IL/JSON"
    try:
        raw = http_get_json(url, timeout=45)
    except Exception as e:
        print(f"[TRI] EPA fetch failed: {e}")
        return []
    facilities = []
    seen_ids = set()
    for f in raw:
        if not isinstance(f, dict): continue
        tri_id = f.get("tri_facility_id") or f.get("TRI_FACILITY_ID")
        if not tri_id or tri_id in seen_ids: continue
        lat = f.get("pref_latitude") or f.get("PREF_LATITUDE")
        lng = f.get("pref_longitude") or f.get("PREF_LONGITUDE")
        try:
            lat = float(lat) if lat else None
            lng = float(lng) if lng else None
        except Exception:
            lat = lng = None
        if lat is None or lng is None: continue
        if lng > 0:
            lng = -lng
        if not (41.6 <= lat <= 42.05 and -88.0 <= lng <= -87.5): continue
        seen_ids.add(tri_id)
        facilities.append({
            "id": tri_id,
            "name": f.get("facility_name") or f.get("FACILITY_NAME", "Unknown"),
            "address": f.get("street_address") or f.get("STREET_ADDRESS", ""),
            "city": f.get("city_name") or f.get("CITY_NAME", ""),
            "zip": f.get("zip_code") or f.get("ZIP_CODE", ""),
            "industry": f.get("asgn_federal_ind") or f.get("ASGN_FEDERAL_IND", "") or f.get("parent_co_name") or f.get("PARENT_CO_NAME", ""),
            "latitude": lat,
            "longitude": lng,
        })
    return facilities


# ─── EPA Superfund (NPL + ER + curated MGP list) ──────────────────────────────

def _arcgis_query(url: str, params: dict) -> list:
    full = url + "?" + urllib.parse.urlencode(params)
    return http_get_json(full, timeout=30).get("features", []) or []


def _in_chicago_bbox(lat, lng) -> bool:
    return lat is not None and lng is not None and 41.6 <= lat <= 42.05 and -88.0 <= lng <= -87.5


def fetch_superfund_sites():
    """
    Combine three Superfund-related sources in the Chicago bbox:
    - NPL (federally-designated Superfund) from EPA's EMEF/efpoints layer 0
    - ER/Removal actions (CERCLA + OPA emergency-response cleanups) from myenv/myenvlayers layer 0
    - Curated list of Peoples Gas Manufactured Gas Plant (MGP) sites not in EPA's public layers
    Deduped by ID.
    """
    sites = []
    seen = set()

    # NPL — use pgm_sys_id as the canonical id (matches the curated list's id format)
    try:
        npl_feats = _arcgis_query(
            "https://geopub.epa.gov/arcgis/rest/services/EMEF/efpoints/MapServer/0/query",
            {
                "where": "1=1",
                "geometry": CHICAGO_BBOX,
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "outFields": "pgm_sys_id,site_id,primary_name,location_address,city_name,postal_code,latitude,longitude,profile_url",
                "returnGeometry": "false",
                "outSR": "4326",
                "f": "json",
            },
        )
    except Exception as e:
        print(f"[Superfund] NPL fetch failed: {e}")
        npl_feats = []

    for feat in npl_feats:
        a = feat.get("attributes", {}) or {}
        site_id = a.get("pgm_sys_id") or a.get("site_id")
        if not site_id or site_id in seen:
            continue
        try:
            lat = float(a["latitude"]) if a.get("latitude") is not None else None
            lng = float(a["longitude"]) if a.get("longitude") is not None else None
        except Exception:
            continue
        if not _in_chicago_bbox(lat, lng):
            continue
        seen.add(site_id)
        sites.append({
            "id": site_id,
            "name": a.get("primary_name", "Unknown"),
            "address": a.get("location_address", ""),
            "city": a.get("city_name", ""),
            "zip": a.get("postal_code", ""),
            "status": "Final NPL",
            "category": "Superfund (NPL)",
            "latitude": lat,
            "longitude": lng,
            "profile_url": a.get("profile_url", ""),
        })

    # ER / Removal actions
    try:
        er_feats = _arcgis_query(
            "https://geopub.epa.gov/arcgis/rest/services/myenv/myenvlayers/MapServer/0/query",
            {
                "where": "1=1",
                "geometry": CHICAGO_BBOX,
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "outFields": "SiteID,SiteName,Address1,City,State,ZIP,Latitude,Longitude,NPLStatus,IncidentCategory,ResponseType,ResponseAuthority,URL,CompletionDate",
                "returnGeometry": "false",
                "outSR": "4326",
                "f": "json",
            },
        )
    except Exception as e:
        print(f"[Superfund] ER fetch failed: {e}")
        er_feats = []

    for feat in er_feats:
        a = feat.get("attributes", {}) or {}
        site_id = str(a.get("SiteID") or "")
        if not site_id or site_id in seen:
            continue
        try:
            lat = float(a["Latitude"]) if a.get("Latitude") is not None else None
            lng = float(a["Longitude"]) if a.get("Longitude") is not None else None
        except Exception:
            continue
        if not _in_chicago_bbox(lat, lng):
            continue
        seen.add(site_id)
        is_complete = a.get("CompletionDate") is not None
        sites.append({
            "id": site_id,
            "name": a.get("SiteName", "Unknown"),
            "address": a.get("Address1", "") or "",
            "city": a.get("City", "") or "",
            "zip": a.get("ZIP", "") or "",
            "status": "Completed" if is_complete else "Active",
            "category": f"{a.get('IncidentCategory') or 'Removal Action'} ({a.get('ResponseAuthority') or 'CERCLA'})",
            "latitude": lat,
            "longitude": lng,
            "profile_url": a.get("URL", "") or "",
        })

    # Curated supplement — Peoples Gas MGP sites and other locally-tracked Superfund sites
    # not exposed by EPA's public ArcGIS layers
    for curated in CHICAGO_SUPERFUND_SITES:
        cid = curated.get("id")
        if not cid or cid in seen:
            continue
        seen.add(cid)
        status = curated.get("status", "")
        category = "Manufactured Gas Plant" if "Non-NPL" in status else "Superfund (NPL)"
        sites.append({
            "id": cid,
            "name": curated.get("name", "Unknown"),
            "address": curated.get("address", ""),
            "city": curated.get("city", "Chicago"),
            "zip": curated.get("zip", ""),
            "status": status,
            "category": category,
            "latitude": curated.get("latitude"),
            "longitude": curated.get("longitude"),
            "profile_url": curated.get("profile_url", ""),
        })

    return sites


# ─── Open-Meteo Weather ───────────────────────────────────────────────────────


WMO_WEATHER = {
    0: ("Clear sky", "☀️"),
    1: ("Mainly clear", "🌤️"), 2: ("Partly cloudy", "⛅"), 3: ("Overcast", "☁️"),
    45: ("Fog", "🌫️"), 48: ("Rime fog", "🌫️"),
    51: ("Light drizzle", "🌦️"), 53: ("Drizzle", "🌦️"), 55: ("Heavy drizzle", "🌧️"),
    56: ("Light freezing drizzle", "🌨️"), 57: ("Freezing drizzle", "🌨️"),
    61: ("Light rain", "🌦️"), 63: ("Rain", "🌧️"), 65: ("Heavy rain", "🌧️"),
    66: ("Light freezing rain", "🌨️"), 67: ("Freezing rain", "🌨️"),
    71: ("Light snow", "🌨️"), 73: ("Snow", "❄️"), 75: ("Heavy snow", "❄️"),
    77: ("Snow grains", "🌨️"),
    80: ("Light showers", "🌦️"), 81: ("Showers", "🌧️"), 82: ("Heavy showers", "⛈️"),
    85: ("Snow showers", "🌨️"), 86: ("Heavy snow showers", "❄️"),
    95: ("Thunderstorm", "⛈️"), 96: ("Thunderstorm w/ hail", "⛈️"), 99: ("Severe thunderstorm", "⛈️"),
}


def weather_label_emoji(code):
    label, emoji = WMO_WEATHER.get(int(code), ("Unknown", "🌡️"))
    return {"code": int(code), "label": label, "emoji": emoji}


def fetch_weather():
    forecast_url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={CHICAGO_LAT}&longitude={CHICAGO_LNG}"
        "&current=temperature_2m,apparent_temperature,is_day,relative_humidity_2m,"
        "precipitation,weather_code,wind_speed_10m,wind_direction_10m,uv_index"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,"
        "sunrise,sunset,precipitation_probability_max,wind_speed_10m_max,uv_index_max"
        "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch"
        "&forecast_days=7&timezone=America%2FChicago"
    )
    data = http_get_json(forecast_url, timeout=20)
    cur = data.get("current", {}) or {}
    daily = data.get("daily", {}) or {}

    current = {
        "time": cur.get("time", ""),
        "temperature_f": cur.get("temperature_2m"),
        "feels_like_f": cur.get("apparent_temperature"),
        "humidity_pct": cur.get("relative_humidity_2m"),
        "precipitation_in": cur.get("precipitation"),
        "wind_speed_mph": cur.get("wind_speed_10m"),
        "wind_direction_deg": cur.get("wind_direction_10m"),
        "uv_index": cur.get("uv_index"),
        "is_day": bool(cur.get("is_day")),
        "weather": weather_label_emoji(cur.get("weather_code", 0)),
    }

    days = []
    times = daily.get("time", []) or []
    for i, date_str in enumerate(times):
        days.append({
            "date": date_str,
            "temp_max_f": daily.get("temperature_2m_max", [None] * len(times))[i],
            "temp_min_f": daily.get("temperature_2m_min", [None] * len(times))[i],
            "precip_prob_pct": daily.get("precipitation_probability_max", [None] * len(times))[i],
            "wind_max_mph": daily.get("wind_speed_10m_max", [None] * len(times))[i],
            "uv_max": daily.get("uv_index_max", [None] * len(times))[i],
            "sunrise": daily.get("sunrise", [None] * len(times))[i],
            "sunset": daily.get("sunset", [None] * len(times))[i],
            "weather": weather_label_emoji(daily.get("weather_code", [0] * len(times))[i]),
        })

    return {
        "available": True,
        "location": "Chicago, IL",
        "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
        "current": current,
        "daily": days,
        "source": "Open-Meteo",
    }


@app.get("/")
def home():
    return {
        "message": "EnviroSight Chicago API", "version": "1.6.0",
        "endpoints": [
            "/health", "/retry-init", "/refresh-cache",
            "/risk-scores", "/risk-scores/{community_area}",
            "/api/current-risk-map",
            "/api/airnow-summary", "/api/airnow-stations",
            "/api/tri-facilities", "/api/superfund-sites",
            "/api/public-health", "/api/weather",
        ],
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "earth_engine_ready": EARTH_ENGINE_READY,
        "earth_engine_message": EE_INIT_MESSAGE,
        "airnow_key_configured": bool(AIRNOW_API_KEY),
    }


@app.post("/retry-init")
def retry_init():
    global EARTH_ENGINE_READY, EE_INIT_MESSAGE
    EARTH_ENGINE_READY, EE_INIT_MESSAGE = initialize_earth_engine()
    return {"earth_engine_ready": EARTH_ENGINE_READY, "earth_engine_message": EE_INIT_MESSAGE}


@app.post("/refresh-cache")
def refresh_cache():
    global cached_geojson, cached_at, airnow_stations_cache, airnow_stations_cached_at
    global airnow_summary_cache, airnow_summary_cached_at, tri_cache, tri_cached_at
    global public_health_cache, public_health_cached_at, weather_cache, weather_cached_at
    global superfund_cache, superfund_cached_at
    cached_geojson = None
    cached_at = 0
    airnow_stations_cache = None
    airnow_stations_cached_at = 0
    airnow_summary_cache = None
    airnow_summary_cached_at = 0
    tri_cache = None
    tri_cached_at = 0
    superfund_cache = None
    superfund_cached_at = 0
    public_health_cache = None
    public_health_cached_at = 0
    weather_cache = None
    weather_cached_at = 0
    return {"status": "all caches cleared"}


@app.get("/risk-scores")
def risk_scores():
    return [f.get("properties", {}) for f in load_backup_geojson().get("features", [])]


@app.get("/risk-scores/{community_area}")
def one_risk_score(community_area: str):
    target = community_area.lower()
    for f in load_backup_geojson().get("features", []):
        props = f.get("properties", {})
        if get_community_name(props).lower() == target:
            return props
    raise HTTPException(status_code=404, detail="Community area not found")


@app.get("/api/current-risk-map")
def current_risk_map():
    global cached_geojson, cached_at
    now = time.time()
    if cached_geojson is not None and now - cached_at < CACHE_SECONDS:
        return cached_geojson
    try:
        geojson = build_current_geojson()
        cached_geojson = geojson
        cached_at = now
        return geojson
    except Exception as error:
        print("Live EE route failed:", error)
        return add_backup_note(load_backup_geojson())


@app.get("/api/airnow-summary")
def airnow_summary():
    global airnow_summary_cache, airnow_summary_cached_at
    now = time.time()
    if airnow_summary_cache is not None and now - airnow_summary_cached_at < AIRNOW_CACHE_SECONDS:
        return airnow_summary_cache
    try:
        data = fetch_airnow_summary()
        airnow_summary_cache = data
        airnow_summary_cached_at = now
        return data
    except Exception as error:
        return {"available": False, "message": str(error)}


@app.get("/api/airnow-stations")
def airnow_stations():
    global airnow_stations_cache, airnow_stations_cached_at
    now = time.time()
    if airnow_stations_cache is not None and now - airnow_stations_cached_at < AIRNOW_CACHE_SECONDS:
        return airnow_stations_cache
    try:
        data = fetch_airnow_stations()
        result = {
            "available": True, "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
            "station_count": len(data), "stations": data,
        }
        airnow_stations_cache = result
        airnow_stations_cached_at = now
        return result
    except Exception as error:
        return {"available": False, "message": str(error), "stations": []}


@app.get("/api/tri-facilities")
def tri_facilities():
    global tri_cache, tri_cached_at
    now = time.time()
    if tri_cache is not None and now - tri_cached_at < TRI_CACHE_SECONDS:
        return tri_cache
    try:
        data = fetch_tri_facilities()
        result = {
            "available": True, "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
            "facility_count": len(data), "facilities": data,
            "source": "EPA Envirofacts (TRI program)",
        }
        tri_cache = result
        tri_cached_at = now
        return result
    except Exception as error:
        return {"available": False, "message": str(error), "facilities": []}


@app.get("/api/superfund-sites")
def superfund_sites():
    global superfund_cache, superfund_cached_at
    now = time.time()
    if superfund_cache is not None and now - superfund_cached_at < SUPERFUND_CACHE_SECONDS:
        return superfund_cache
    try:
        data = fetch_superfund_sites()
        result = {
            "available": True, "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
            "site_count": len(data), "sites": data,
            "source": "EPA Envirofacts (NPL + ER) + curated Chicago MGP sites",
        }
        superfund_cache = result
        superfund_cached_at = now
        return result
    except Exception as error:
        return {"available": False, "message": str(error), "sites": []}


@app.get("/api/public-health")
def public_health():
    try:
        data = get_public_health_cached()
        return {
            "available": True,
            "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
            "community_count": len(data), "data": data,
            "source": "Chicago Data Portal — Public Health Statistics (iqnk-2tcu)",
        }
    except Exception as error:
        return {"available": False, "message": str(error), "data": {}}


@app.get("/api/weather")
def api_weather():
    global weather_cache, weather_cached_at
    now = time.time()
    if weather_cache is not None and now - weather_cached_at < WEATHER_CACHE_SECONDS:
        return weather_cache
    try:
        data = fetch_weather()
        weather_cache = data
        weather_cached_at = now
        return data
    except Exception as error:
        print(f"[Weather] Fetch failed: {error}")
        return {"available": False, "message": str(error)}

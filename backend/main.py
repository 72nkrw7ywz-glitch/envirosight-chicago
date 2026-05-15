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

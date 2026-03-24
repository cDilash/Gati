#!/usr/bin/env python3
"""
Garmin Connect → Supabase sync script.
Fetches HRV, VO2max, Body Battery, stress, respiratory rate, SpO2,
training status, training readiness, sleep score from Garmin Connect.
Writes to Supabase garmin_health table.

Usage:
  python scripts/garmin_fetch.py              # fetch today + yesterday
  python scripts/garmin_fetch.py --backfill 14  # fetch last 14 days
  python scripts/garmin_fetch.py --debug       # print raw JSON for today

Prerequisites:
  1. Run garmin_auth_v2.py first (saves tokens to ~/.garth)
  2. Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars (or edit .env)
"""

import warnings
warnings.filterwarnings("ignore", message="Logfire API is unreachable")
import os
os.environ["LOGFIRE_SEND_TO_LOGFIRE"] = "false"

import garth
import json
import sys
from datetime import datetime, timedelta

# ─── Supabase config ─────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://dweimilkuzasrxscjgag.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_KEY:
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("SUPABASE_SERVICE_KEY="):
                    SUPABASE_KEY = line.split("=", 1)[1].strip()

# ─── Garmin display name (needed for some endpoints) ─────────
_display_name = None

def get_display_name() -> str:
    global _display_name
    if _display_name:
        return _display_name
    try:
        profile = garth.connectapi("/userprofile-service/socialProfile")
        _display_name = profile.get("displayName", "")
    except:
        _display_name = ""
    return _display_name

# ─── Garmin API endpoints ────────────────────────────────────

def fetch_hrv(date_str: str) -> dict:
    """HRV summary — overnight average, weekly average, baseline."""
    try:
        return garth.connectapi(f"/hrv-service/hrv/{date_str}") or {}
    except Exception as e:
        print(f"  ✗ HRV: {e}")
        return {}

def fetch_daily_summary(date_str: str) -> dict:
    """Daily summary — resting HR, stress, intensity minutes, floors, steps, SpO2."""
    try:
        dn = get_display_name()
        return garth.connectapi(
            f"/usersummary-service/usersummary/daily/{dn}",
            params={"calendarDate": date_str}
        ) or {}
    except Exception as e:
        print(f"  ✗ Daily summary: {e}")
        return {}

def fetch_body_battery(date_str: str) -> list:
    """Body Battery — charged, drained, hourly values."""
    try:
        data = garth.connectapi(
            "/wellness-service/wellness/bodyBattery/reports/daily",
            params={"startDate": date_str, "endDate": date_str}
        )
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"  ✗ Body battery: {e}")
        return []

def fetch_training_readiness(date_str: str) -> dict:
    """Training readiness — overall score + component factors."""
    try:
        return garth.connectapi(f"/metrics-service/metrics/trainingreadiness/{date_str}") or {}
    except Exception as e:
        print(f"  ✗ Training readiness: {e}")
        return {}

def fetch_training_status(date_str: str) -> dict:
    """Training status — load, ACWR, status feedback, VO2max."""
    try:
        return garth.connectapi(f"/metrics-service/metrics/trainingstatus/aggregated/{date_str}") or {}
    except Exception as e:
        print(f"  ✗ Training status: {e}")
        return {}

def fetch_sleep_data(date_str: str) -> dict:
    """Sleep data — duration, stages, sleep score, respiratory rate."""
    try:
        dn = get_display_name()
        return garth.connectapi(
            f"/wellness-service/wellness/dailySleepData/{dn}",
            params={"date": date_str, "nonSleepBufferMinutes": "60"}
        ) or {}
    except Exception as e:
        print(f"  ✗ Sleep: {e}")
        return {}

def fetch_stress(date_str: str) -> dict:
    """Daily stress detail."""
    try:
        return garth.connectapi(f"/wellness-service/wellness/dailyStress/{date_str}") or {}
    except Exception as e:
        print(f"  ✗ Stress: {e}")
        return {}

def fetch_respiration(date_str: str) -> dict:
    """Daily respiration."""
    try:
        return garth.connectapi(f"/wellness-service/wellness/daily/respiration/{date_str}") or {}
    except Exception as e:
        print(f"  ✗ Respiration: {e}")
        return {}

def fetch_spo2(date_str: str) -> dict:
    """Daily SpO2."""
    try:
        return garth.connectapi(f"/wellness-service/wellness/daily/spo2/{date_str}") or {}
    except Exception as e:
        print(f"  ✗ SpO2: {e}")
        return {}

def fetch_vo2max(date_str: str) -> dict:
    """VO2max / MaxMet."""
    try:
        return garth.connectapi(f"/metrics-service/metrics/maxmet/latest/{date_str}") or {}
    except Exception as e:
        print(f"  ✗ VO2max: {e}")
        return {}

def fetch_endurance_score(date_str: str) -> dict:
    """Endurance score — aerobic fitness trend."""
    try:
        return garth.connectapi(f"/metrics-service/metrics/endurancescore/daily/{date_str}") or {}
    except:
        try:
            return garth.connectapi(f"/metrics-service/metrics/endurancescore") or {}
        except Exception as e:
            print(f"  ✗ Endurance score: {e}")
            return {}

def fetch_race_predictions() -> dict:
    """Race predictions — try multiple known endpoints."""
    endpoints = [
        "/metrics-service/metrics/racepredictions",
        "/fitnessstats-service/racePredictions",
        "/metrics-service/metrics/maxmet/racepredictions",
    ]
    for ep in endpoints:
        try:
            r = garth.connectapi(ep)
            if r:
                return r
        except:
            pass
    return {}

# ─── Parse responses ──────────────────────────────────────────

def parse_garmin_data(date_str: str) -> dict:
    """Fetch all endpoints and parse into a flat dict for Supabase."""
    print(f"\n📅 Fetching data for {date_str}...")

    hrv = fetch_hrv(date_str)
    daily = fetch_daily_summary(date_str)
    bb = fetch_body_battery(date_str)
    readiness = fetch_training_readiness(date_str)
    training = fetch_training_status(date_str)
    sleep = fetch_sleep_data(date_str)
    stress = fetch_stress(date_str)
    resp = fetch_respiration(date_str)
    spo2 = fetch_spo2(date_str)
    vo2 = fetch_vo2max(date_str)
    race_preds = fetch_race_predictions()
    endurance = fetch_endurance_score(date_str)

    # Tier 3: Hill score
    hill_score_data = {}
    try:
        hill_score_data = garth.connectapi(f"/metrics-service/metrics/hillscore/daily/{date_str}") or {}
    except:
        try: hill_score_data = garth.connectapi("/metrics-service/metrics/hillscore") or {}
        except: pass

    # Tier 3: Lactate threshold
    lactate_data = {}
    try:
        lactate_data = garth.connectapi(f"/metrics-service/metrics/lactatethreshold/latest/{date_str}") or {}
    except: pass

    # ─── Parse HRV ───
    hrv_summary = hrv.get("hrvSummary", {}) if isinstance(hrv, dict) else {}
    hrv_last_night = hrv_summary.get("lastNightAvg")
    hrv_last_night_5min_high = hrv_summary.get("lastNight5MinHigh")
    hrv_weekly = hrv_summary.get("weeklyAvg")
    baseline = hrv_summary.get("baseline", {}) if isinstance(hrv_summary.get("baseline"), dict) else {}
    hrv_baseline_low = baseline.get("balancedLow") or baseline.get("lowUpper")
    hrv_baseline_high = baseline.get("balancedUpper")
    hrv_status = hrv_summary.get("status")
    hrv_feedback = hrv_summary.get("feedbackPhrase")

    # ─── Parse daily summary ───
    resting_hr = daily.get("restingHeartRate") if isinstance(daily, dict) else None
    max_hr_daily = daily.get("maxHeartRate") if isinstance(daily, dict) else None
    min_hr_daily = daily.get("minHeartRate") if isinstance(daily, dict) else None
    rhr_7day_avg = daily.get("lastSevenDaysAvgRestingHeartRate") if isinstance(daily, dict) else None
    stress_avg = daily.get("averageStressLevel") if isinstance(daily, dict) else None
    stress_high = daily.get("maxStressLevel") if isinstance(daily, dict) else None
    stress_qualifier = daily.get("stressQualifier") if isinstance(daily, dict) else None
    vigorous_min = daily.get("vigorousIntensityMinutes") if isinstance(daily, dict) else None
    bb_at_wake = daily.get("bodyBatteryAtWakeTime") if isinstance(daily, dict) else None
    moderate_min = daily.get("moderateIntensityMinutes") if isinstance(daily, dict) else None
    floors_climbed = daily.get("floorsAscended") if isinstance(daily, dict) else None
    if isinstance(floors_climbed, float):
        floors_climbed = round(floors_climbed)

    # ─── Parse Body Battery ───
    bb_morning = None
    bb_high = None
    bb_low = None
    bb_charged = None
    bb_drained = None
    if isinstance(bb, list) and len(bb) > 0:
        entry = bb[0]
        bb_charged = entry.get("charged")
        bb_drained = entry.get("drained")
        vals_arr = entry.get("bodyBatteryValuesArray", [])
        if vals_arr:
            # Array of [timestamp_ms, value] pairs
            values = [v[1] for v in vals_arr if isinstance(v, list) and len(v) >= 2]
            if values:
                bb_high = max(values)
                bb_low = min(values)
                bb_morning = values[-1] if len(values) <= 3 else max(values[:4])  # highest morning value

    # ─── Parse training readiness ───
    # Response is an ARRAY of readings — use the most recent (first entry)
    tr_score = None
    readiness_feedback_short = None
    readiness_feedback_long = None
    recovery_time_hours = None
    readiness_entry = None
    if isinstance(readiness, list) and len(readiness) > 0:
        readiness_entry = readiness[0]  # most recent reading
    elif isinstance(readiness, dict):
        readiness_entry = readiness

    if readiness_entry:
        tr_score = readiness_entry.get("score")
        readiness_feedback_short = readiness_entry.get("feedbackShort")
        readiness_feedback_long = readiness_entry.get("feedbackLong")
        # Recovery time is in MINUTES
        recovery_min = readiness_entry.get("recoveryTime")
        if recovery_min is not None and isinstance(recovery_min, (int, float)):
            recovery_time_hours = round(recovery_min / 60, 1)

    # ─── Parse training status ───
    training_status_text = None
    training_load_7day = None
    training_load_category = None
    acwr_value = None
    acwr_status = None
    ts_data = training.get("mostRecentTrainingStatus", {}).get("latestTrainingStatusData", {})
    for device_id, data in ts_data.items():
        status_code = data.get("trainingStatus")
        status_map = {0: "No Status", 1: "Detraining", 2: "Recovery", 3: "Unproductive", 4: "Maintaining", 5: "Productive", 6: "Peaking", 7: "Overreaching"}
        training_status_text = status_map.get(status_code, f"Unknown ({status_code})")
        acwr_dto = data.get("acuteTrainingLoadDTO", {})
        training_load_7day = acwr_dto.get("dailyTrainingLoadAcute")
        acwr_value = acwr_dto.get("dailyAcuteChronicWorkloadRatio")
        acwr_status = acwr_dto.get("acwrStatus")
        break  # Use primary device

    # ─── Parse VO2max ───
    vo2max_running = None
    generic = vo2.get("generic", {}) if isinstance(vo2, dict) else {}
    vo2max_running = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")

    # ─── Parse sleep ───
    sleep_dto = sleep.get("dailySleepDTO", {}) if isinstance(sleep, dict) else {}
    respiratory_rate = sleep_dto.get("averageRespirationValue")
    spo2_avg = sleep_dto.get("averageSpO2Value")
    sleep_score = None
    sleep_scores = sleep_dto.get("sleepScores", {})
    sleep_subscores = {}
    if isinstance(sleep_scores, dict):
        overall = sleep_scores.get("overall", {})
        sleep_score = overall.get("value") if isinstance(overall, dict) else None
        # Parse all 8 sub-scores
        for key in ["totalDuration", "stress", "awakeCount", "remPercentage", "restlessness", "lightPercentage", "deepPercentage", "quality"]:
            sub = sleep_scores.get(key, {})
            if isinstance(sub, dict) and sub.get("value") is not None:
                sleep_subscores[key] = sub["value"]

    # Sleep need
    sleep_need_minutes = None
    sleep_debt_minutes = None
    sleep_need_obj = sleep_dto.get("sleepNeed", {})
    if isinstance(sleep_need_obj, dict):
        baseline = sleep_need_obj.get("baseline")
        if baseline and isinstance(baseline, (int, float)):
            sleep_need_minutes = round(baseline / 60000) if baseline > 1000 else round(baseline)  # ms or minutes
        actual_sleep_min = sleep_dto.get("sleepTimeSeconds")
        if actual_sleep_min and sleep_need_minutes:
            actual_min = round(actual_sleep_min / 60) if actual_sleep_min > 1000 else actual_sleep_min
            sleep_debt_minutes = max(0, sleep_need_minutes - actual_min)

    # ─── Parse skin temp deviation (from sleep data) ───
    skin_temp_dev = sleep_dto.get("averageSkinTempDeviationC") or sleep_dto.get("avgSkinTempDeviationC")
    if skin_temp_dev is not None:
        skin_temp_dev = round(skin_temp_dev, 1)

    # ─── Parse endurance score ───
    endurance_score = None
    endurance_classification = None
    if isinstance(endurance, dict):
        endurance_score = endurance.get("overallScore") or endurance.get("enduranceScore")
        endurance_classification = endurance.get("enduranceClassification") or endurance.get("classification")
    elif isinstance(endurance, list) and len(endurance) > 0:
        endurance_score = endurance[0].get("overallScore") or endurance[0].get("enduranceScore")
        endurance_classification = endurance[0].get("enduranceClassification")

    # ─── Parse min SpO2 (from sleep) ───
    min_spo2 = sleep_dto.get("lowestSpO2Value") or sleep_dto.get("lowestSpo2")

    # ─── Parse sleep awake count + avg sleep stress ───
    sleep_awake_count = sleep_dto.get("awakeCount")
    avg_sleep_stress = sleep_dto.get("avgSleepStress")

    # ─── Parse hill score ───
    hill_score = None
    hill_endurance = None
    hill_strength = None
    if isinstance(hill_score_data, dict):
        hill_score = hill_score_data.get("overallScore") or hill_score_data.get("hillScore")
        hill_endurance = hill_score_data.get("enduranceScore")
        hill_strength = hill_score_data.get("strengthScore")
    elif isinstance(hill_score_data, list) and len(hill_score_data) > 0:
        hill_score = hill_score_data[0].get("overallScore")
        hill_endurance = hill_score_data[0].get("enduranceScore")
        hill_strength = hill_score_data[0].get("strengthScore")

    # ─── Parse lactate threshold ───
    lactate_threshold_hr = None
    lactate_threshold_speed = None
    if isinstance(lactate_data, dict):
        lactate_threshold_hr = lactate_data.get("lactateThresholdHeartRate") or lactate_data.get("ltHR")
        lactate_threshold_speed = lactate_data.get("lactateThresholdSpeed") or lactate_data.get("ltSpeed")

    # ─── Parse VO2max fitness age ───
    vo2max_fitness_age = generic.get("fitnessAge") if isinstance(generic, dict) else None

    # ─── Parse SpO2 (from dedicated endpoint if sleep didn't have it) ───
    if not spo2_avg and isinstance(spo2, dict):
        spo2_avg = spo2.get("averageSPO2") or spo2.get("averageSpO2")

    # ─── Parse respiration (fallback) ───
    if not respiratory_rate and isinstance(resp, dict):
        respiratory_rate = resp.get("avgSleepRespiration") or resp.get("avgWakingRespiration")

    # ─── Parse race predictions ───
    predicted_5k = None
    predicted_10k = None
    predicted_half = None
    predicted_marathon = None
    if isinstance(race_preds, (dict, list)):
        preds = race_preds if isinstance(race_preds, list) else race_preds.get("racePredictions", race_preds.get("predictions", []))
        if isinstance(preds, list):
            for pred in preds:
                dist = pred.get("raceDistance", {}).get("key", "") if isinstance(pred.get("raceDistance"), dict) else str(pred.get("raceDistance", ""))
                time_sec = pred.get("racePredictionInSeconds") or pred.get("predictedTime")
                if not time_sec:
                    continue
                time_sec = int(time_sec)
                if "5" in dist and "10" not in dist and "half" not in dist.lower():
                    predicted_5k = time_sec
                elif "10" in dist and "half" not in dist.lower():
                    predicted_10k = time_sec
                elif "half" in dist.lower() or "21" in dist:
                    predicted_half = time_sec
                elif "marathon" in dist.lower() or "42" in dist:
                    predicted_marathon = time_sec

    # Fallback: estimate race predictions from VO2max using Daniels' tables (lookup)
    if vo2max_running and not predicted_5k:
        v = vo2max_running
        # Daniels VDOT table: VDOT → 5K time in seconds (approximate)
        vdot_5k = {30: 1860, 32: 1770, 34: 1680, 36: 1605, 38: 1530, 40: 1464,
                   42: 1404, 44: 1344, 46: 1290, 48: 1242, 50: 1194, 52: 1152,
                   54: 1110, 56: 1074, 58: 1038, 60: 1008, 65: 930, 70: 864}
        # Find closest VDOT entry
        closest = min(vdot_5k.keys(), key=lambda k: abs(k - v))
        predicted_5k = vdot_5k[closest]
        predicted_10k = int(predicted_5k * 2.09)
        predicted_half = int(predicted_10k * 2.22)
        predicted_marathon = int(predicted_half * 2.11)

    # ─── Build row ───
    row = {
        "date": date_str,
        # HRV
        "hrv_last_night_avg": hrv_last_night,
        "hrv_weekly_avg": hrv_weekly,
        "hrv_baseline_low": hrv_baseline_low,
        "hrv_baseline_high": hrv_baseline_high,
        "hrv_status": hrv_status,
        # VO2max
        "vo2max": vo2max_running,
        # Body Battery
        "body_battery_morning": bb_morning,
        "body_battery_high": bb_high,
        "body_battery_low": bb_low,
        "body_battery_charged": bb_charged,
        "body_battery_drained": bb_drained,
        # Stress
        "stress_avg": stress_avg,
        "stress_high": stress_high,
        # Vitals
        "respiratory_rate": respiratory_rate,
        "spo2_avg": spo2_avg,
        "resting_hr": resting_hr,
        # Training
        "training_readiness": tr_score,
        "training_status": training_status_text,
        "training_load_7day": training_load_7day,
        "acwr": acwr_value,
        "acwr_status": acwr_status,
        # Sleep
        "sleep_score": sleep_score,
        # Intensity
        "intensity_minutes_vigorous": vigorous_min,
        "intensity_minutes_moderate": moderate_min,
        "floors_climbed": floors_climbed,
        # NEW: Readiness feedback + recovery
        "readiness_feedback_short": readiness_feedback_short,
        "readiness_feedback_long": readiness_feedback_long,
        "recovery_time_hours": recovery_time_hours,
        # NEW: Race predictions
        "predicted_5k_sec": predicted_5k,
        "predicted_10k_sec": predicted_10k,
        "predicted_half_sec": predicted_half,
        "predicted_marathon_sec": predicted_marathon,
        # NEW: Sleep sub-scores + need
        "sleep_subscores_json": json.dumps(sleep_subscores) if sleep_subscores else None,
        "sleep_need_minutes": sleep_need_minutes,
        "sleep_debt_minutes": sleep_debt_minutes,
        # NEW Tier 2: Endurance score + skin temp
        "endurance_score": endurance_score,
        "endurance_classification": endurance_classification,
        "skin_temp_deviation_c": skin_temp_dev,
        # Tier 3
        "max_hr_daily": max_hr_daily,
        "min_hr_daily": min_hr_daily,
        "rhr_7day_avg": rhr_7day_avg,
        "stress_qualifier": stress_qualifier,
        "bb_at_wake": bb_at_wake,
        "hrv_5min_high": hrv_last_night_5min_high,
        "hrv_feedback": hrv_feedback,
        "min_spo2": min_spo2,
        "sleep_awake_count": sleep_awake_count,
        "avg_sleep_stress": avg_sleep_stress,
        "hill_score": hill_score,
        "hill_endurance": hill_endurance,
        "hill_strength": hill_strength,
        "lactate_threshold_hr": lactate_threshold_hr,
        "lactate_threshold_speed": round(lactate_threshold_speed, 4) if lactate_threshold_speed else None,
        "vo2max_fitness_age": vo2max_fitness_age,
        # Meta
        "fetched_at": datetime.now(tz=__import__('datetime').timezone.utc).isoformat(),
    }

    # Print what we got
    vals = {k: v for k, v in row.items() if v is not None and k not in ("date", "fetched_at")}
    if vals:
        print(f"  ✓ Got {len(vals)} fields:")
        for k, v in vals.items():
            print(f"    {k}: {v}")
    else:
        print(f"  ⚠ No data returned for {date_str}")

    return row

# ─── Supabase upsert ──────────────────────────────────────────

def upsert_to_supabase(rows: list[dict], user_id: str):
    """Write rows to Supabase garmin_health table."""
    if not SUPABASE_KEY:
        print("\n⚠ SUPABASE_SERVICE_KEY not set. Printing data only:")
        for row in rows:
            print(json.dumps(row, indent=2))
        return

    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    for row in rows:
        row["user_id"] = user_id
        # Remove None values to avoid overwriting existing data with null
        clean_row = {k: v for k, v in row.items() if v is not None}
        try:
            sb.table("garmin_health").upsert(clean_row, on_conflict="user_id,date").execute()
        except Exception as e:
            print(f"  ✗ Supabase upsert failed for {row['date']}: {e}")

    print(f"\n✓ Upserted {len(rows)} rows to Supabase")

# ─── Main ─────────────────────────────────────────────────────

def main():
    try:
        garth.resume("~/.garth")
        print("✓ Garmin tokens loaded")
    except Exception as e:
        print(f"✗ Could not load Garmin tokens: {e}")
        print("  Run: python scripts/garmin_auth_v2.py")
        sys.exit(1)

    # Determine date range
    days_back = 2
    if "--backfill" in sys.argv:
        idx = sys.argv.index("--backfill")
        if idx + 1 < len(sys.argv):
            days_back = int(sys.argv[idx + 1])

    # Get user_id from .env
    user_id = os.environ.get("SUPABASE_USER_ID", "")
    if not user_id:
        env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("SUPABASE_USER_ID="):
                        user_id = line.split("=", 1)[1].strip()

    if not user_id:
        print("⚠ SUPABASE_USER_ID not set — will print data only")

    # Fetch
    rows = []
    today = datetime.now()
    for i in range(days_back):
        d = today - timedelta(days=i)
        date_str = d.strftime("%Y-%m-%d")
        row = parse_garmin_data(date_str)
        has_data = any(v is not None for k, v in row.items() if k not in ("date", "fetched_at"))
        if has_data:
            rows.append(row)

    if rows and user_id:
        upsert_to_supabase(rows, user_id)
    elif rows:
        print("\nData fetched (not uploaded — no SUPABASE_USER_ID):")
        for row in rows:
            vals = {k: v for k, v in row.items() if v is not None and k not in ("date", "fetched_at")}
            print(f"  {row['date']}: {len(vals)} fields")
    else:
        print("\nNo data to sync.")

    # ─── Per-Activity Data (Training Effect, Stamina, Load, Temp, GAP) ───
    print("\n── Fetching per-activity data...")
    try:
        activities = garth.connectapi("/activitylist-service/activities/search/activities", params={
            "start": "0", "limit": str(min(days_back * 2, 20)),
        })
        running_activities = [a for a in (activities or []) if a.get("activityType", {}).get("typeKey") == "running"]
        print(f"  Found {len(running_activities)} running activities")

        activity_rows = []
        for act in running_activities:
            act_id = act.get("activityId")
            if not act_id:
                continue
            try:
                detail = garth.connectapi(f"/activity-service/activity/{act_id}")
                if not detail:
                    continue
                summary = detail.get("summaryDTO", {})
                if not summary:
                    continue

                # Extract date from local start time
                start_local = summary.get("startTimeLocal", "")
                act_date = start_local.split("T")[0] if "T" in start_local else ""

                # Match to Strava by date (approximate — same day)
                strava_id = None  # Could cross-reference later

                aero_te = summary.get("trainingEffect")
                aero_msg = summary.get("aerobicTrainingEffectMessage")
                anaero_te = summary.get("anaerobicTrainingEffect", 0)
                anaero_msg = summary.get("anaerobicTrainingEffectMessage")
                stamina_start = summary.get("beginPotentialStamina")
                stamina_end = summary.get("endPotentialStamina") or summary.get("minAvailableStamina")
                act_load = summary.get("activityTrainingLoad")
                temp_avg = summary.get("averageTemperature")
                gap_speed = summary.get("avgGradeAdjustedSpeed")

                # Tier 2: Running dynamics
                gct = summary.get("groundContactTime")              # ms
                vert_osc = summary.get("verticalOscillation")       # cm
                stride_len = summary.get("strideLength")             # cm
                vert_ratio = summary.get("verticalRatio")            # %
                # Tier 2: Running power
                avg_power = summary.get("averagePower")              # watts
                max_power = summary.get("maxPower")
                norm_power = summary.get("normalizedPower")
                # Tier 2: Performance condition (not always in summary — check detail)
                perf_condition = detail.get("performanceCondition") or summary.get("performanceCondition")

                row = {
                    "activity_date": act_date,
                    "garmin_activity_id": str(act_id),
                    "strava_activity_id": strava_id,
                    "aerobic_training_effect": round(aero_te, 1) if aero_te else None,
                    "aerobic_te_message": aero_msg,
                    "anaerobic_training_effect": round(anaero_te, 1) if anaero_te else None,
                    "stamina_start": int(stamina_start) if stamina_start else None,
                    "stamina_end": int(stamina_end) if stamina_end else None,
                    "activity_training_load": round(act_load, 1) if act_load else None,
                    "temperature_avg_c": round(temp_avg, 1) if temp_avg else None,
                    "grade_adjusted_speed": round(gap_speed, 4) if gap_speed else None,
                    # Tier 3: Anaerobic TE message
                    "anaerobic_te_message": anaero_msg,
                    # Tier 2: Running dynamics
                    "ground_contact_time_ms": round(gct, 1) if gct else None,
                    "vertical_oscillation_cm": round(vert_osc, 1) if vert_osc else None,
                    "stride_length_cm": round(stride_len, 1) if stride_len else None,
                    "vertical_ratio": round(vert_ratio, 2) if vert_ratio else None,
                    # Tier 2: Running power
                    "avg_power_watts": round(avg_power) if avg_power else None,
                    "max_power_watts": round(max_power) if max_power else None,
                    "normalized_power_watts": round(norm_power) if norm_power else None,
                    # Tier 2: Performance condition
                    "performance_condition": perf_condition,
                    "fetched_at": datetime.now(tz=__import__('datetime').timezone.utc).isoformat(),
                }

                vals = {k: v for k, v in row.items() if v is not None and k not in ("activity_date", "garmin_activity_id", "fetched_at")}
                if vals:
                    activity_rows.append(row)
                    # Format GAP as pace for display
                    gap_pace = ""
                    if gap_speed and gap_speed > 0:
                        gap_secs = 1609.344 / gap_speed
                        gap_pace = f" · GAP {int(gap_secs // 60)}:{int(gap_secs % 60):02d}/mi"
                    stamina_str = f" · Stamina {row['stamina_start']}→{row['stamina_end']}%" if row['stamina_start'] else ""
                    print(f"  ✓ {act_date}: TE {row['aerobic_training_effect']} ({aero_msg or '?'}), Load {row['activity_training_load']}{stamina_str}{gap_pace}")

            except Exception as e:
                print(f"  ✗ Activity {act_id}: {str(e)[:80]}")

        # Upsert to Supabase
        if activity_rows and user_id and SUPABASE_KEY:
            from supabase import create_client
            sb = create_client(SUPABASE_URL, SUPABASE_KEY)
            for row in activity_rows:
                row["user_id"] = user_id
                clean = {k: v for k, v in row.items() if v is not None}
                try:
                    sb.table("garmin_activity_data").upsert(clean, on_conflict="user_id,garmin_activity_id").execute()
                except Exception as e:
                    print(f"  ✗ Supabase activity upsert failed: {str(e)[:80]}")
            print(f"  ✓ Upserted {len(activity_rows)} activity rows to Supabase")
        elif activity_rows:
            print(f"  {len(activity_rows)} activities fetched (not uploaded)")

    except Exception as e:
        print(f"  ✗ Activity fetch failed: {str(e)[:100]}")

    # Debug mode: print raw JSON
    if "--debug" in sys.argv and days_back > 0:
        date_str = today.strftime("%Y-%m-%d")
        print(f"\n─── RAW JSON for {date_str} ───")
        print("HRV:", json.dumps(fetch_hrv(date_str), indent=2, default=str))
        print("Daily:", json.dumps(fetch_daily_summary(date_str), indent=2, default=str)[:500])
        print("Body Battery:", json.dumps(fetch_body_battery(date_str), indent=2, default=str)[:500])
        print("Training Readiness:", json.dumps(fetch_training_readiness(date_str), indent=2, default=str)[:500])
        print("Training Status:", json.dumps(fetch_training_status(date_str), indent=2, default=str)[:500])
        print("Sleep:", json.dumps(fetch_sleep_data(date_str), indent=2, default=str)[:500])

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Garmin Connect → Supabase sync script.
Fetches HRV, VO2max, Body Battery, stress, respiratory rate, SpO2 from Garmin Connect.
Writes to Supabase garmin_health table.

Usage:
  python scripts/garmin_fetch.py              # fetch today + yesterday
  python scripts/garmin_fetch.py --backfill 14  # fetch last 14 days

Prerequisites:
  1. Run garmin_auth.py first (saves tokens to ~/.garth)
  2. Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars (or edit below)
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
# Use service role key for server-side inserts (bypasses RLS)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://dweimilkuzasrxscjgag.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_KEY:
    # Try loading from .env file
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("SUPABASE_SERVICE_KEY="):
                    SUPABASE_KEY = line.split("=", 1)[1].strip()

# ─── Garmin API endpoints ─────────────────────────────────────

def fetch_hrv(date_str: str) -> dict:
    """Fetch HRV summary for a date."""
    try:
        data = garth.connectapi(f"/hrv-service/hrv/{date_str}")
        return data or {}
    except Exception as e:
        print(f"  HRV fetch failed: {e}")
        return {}

def fetch_daily_summary(date_str: str) -> dict:
    """Fetch daily summary (steps, stress, resting HR, respiratory rate, SpO2)."""
    try:
        data = garth.connectapi(f"/usersummary-service/usersummary/daily/{date_str}")
        return data or {}
    except Exception as e:
        print(f"  Daily summary fetch failed: {e}")
        return {}

def fetch_body_battery(date_str: str) -> dict:
    """Fetch Body Battery data."""
    try:
        data = garth.connectapi(f"/wellness-service/wellness/bodyBattery/day/{date_str}")
        return data or {}
    except Exception as e:
        print(f"  Body Battery fetch failed: {e}")
        return {}

def fetch_training_readiness(date_str: str) -> dict:
    """Fetch training readiness score."""
    try:
        data = garth.connectapi(f"/metrics-service/metrics/trainingreadiness/{date_str}")
        return data or {}
    except Exception as e:
        print(f"  Training readiness fetch failed: {e}")
        return {}

def fetch_sleep_data(date_str: str) -> dict:
    """Fetch sleep data including respiratory rate and SpO2."""
    try:
        data = garth.connectapi(f"/wellness-service/wellness/dailySleepData/{date_str}")
        return data or {}
    except Exception as e:
        print(f"  Sleep data fetch failed: {e}")
        return {}

# ─── Parse responses ──────────────────────────────────────────

def parse_garmin_data(date_str: str) -> dict:
    """Fetch all endpoints and parse into a flat dict for Supabase."""
    print(f"\n📅 Fetching data for {date_str}...")

    hrv = fetch_hrv(date_str)
    daily = fetch_daily_summary(date_str)
    bb = fetch_body_battery(date_str)
    readiness = fetch_training_readiness(date_str)
    sleep = fetch_sleep_data(date_str)

    # Parse HRV
    hrv_summary = hrv.get("hrvSummary", {}) if isinstance(hrv, dict) else {}
    hrv_last_night = hrv_summary.get("lastNightAvg")
    hrv_weekly = hrv_summary.get("weeklyAvg")
    hrv_baseline_low = hrv_summary.get("baselineBalancedLow") or hrv_summary.get("baselineLowUpper")
    hrv_baseline_high = hrv_summary.get("baselineBalancedHigh") or hrv_summary.get("baselineHighUpper")
    hrv_status = hrv_summary.get("status")

    # Parse daily summary
    resting_hr = daily.get("restingHeartRate") if isinstance(daily, dict) else None
    stress_avg = daily.get("averageStressLevel") if isinstance(daily, dict) else None
    resp_rate = daily.get("averageSpo2") if isinstance(daily, dict) else None  # will override from sleep

    # Parse Body Battery — find morning value (highest value early in day)
    bb_morning = None
    if isinstance(bb, list) and len(bb) > 0:
        # Body Battery returns array of timestamped values
        morning_values = [v.get("charged", v.get("value", 0)) for v in bb[:6] if isinstance(v, dict)]
        if morning_values:
            bb_morning = max(morning_values)
    elif isinstance(bb, dict):
        bb_morning = bb.get("charged") or bb.get("bodyBatteryValuesArray", [{}])[0].get("charged") if bb.get("bodyBatteryValuesArray") else None

    # Parse training readiness
    tr_score = None
    if isinstance(readiness, dict):
        tr_score = readiness.get("score") or readiness.get("overallScore")
    elif isinstance(readiness, list) and len(readiness) > 0:
        tr_score = readiness[0].get("score") or readiness[0].get("overallScore")

    # Parse sleep for respiratory rate and SpO2
    respiratory_rate = None
    spo2_avg = None
    if isinstance(sleep, dict):
        respiratory_rate = sleep.get("averageRespirationValue") or sleep.get("lowestRespirationValue")
        spo2_avg = sleep.get("averageSpO2Value") or sleep.get("averageOxygenSaturation")

    # VO2max — from fitness stats
    vo2max = None
    try:
        fitness = garth.connectapi("/fitness-service/fitnessStats")
        if isinstance(fitness, dict):
            vo2max = fitness.get("vo2MaxValue") or fitness.get("vo2Max")
        elif isinstance(fitness, list) and len(fitness) > 0:
            vo2max = fitness[0].get("vo2MaxValue") or fitness[0].get("vo2Max")
    except:
        pass

    row = {
        "date": date_str,
        "hrv_last_night_avg": hrv_last_night,
        "hrv_weekly_avg": hrv_weekly,
        "hrv_baseline_low": hrv_baseline_low,
        "hrv_baseline_high": hrv_baseline_high,
        "hrv_status": hrv_status,
        "vo2max": vo2max,
        "body_battery_morning": bb_morning,
        "stress_avg": stress_avg,
        "respiratory_rate": respiratory_rate,
        "spo2_avg": spo2_avg,
        "training_readiness": tr_score,
        "resting_hr": resting_hr,
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }

    # Print what we got
    vals = {k: v for k, v in row.items() if v is not None and k not in ("date", "fetched_at")}
    if vals:
        print(f"  ✓ Got: {', '.join(f'{k}={v}' for k, v in vals.items())}")
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
        try:
            sb.table("garmin_health").upsert(row, on_conflict="user_id,date").execute()
        except Exception as e:
            print(f"  ✗ Supabase upsert failed for {row['date']}: {e}")

    print(f"\n✓ Upserted {len(rows)} rows to Supabase")

# ─── Main ─────────────────────────────────────────────────────

def main():
    # Resume saved tokens
    try:
        garth.resume("~/.garth")
        print("✓ Garmin tokens loaded")
    except Exception as e:
        print(f"✗ Could not load Garmin tokens: {e}")
        print("  Run: python scripts/garmin_auth.py")
        sys.exit(1)

    # Determine date range
    days_back = 2  # default: today + yesterday
    if "--backfill" in sys.argv:
        idx = sys.argv.index("--backfill")
        if idx + 1 < len(sys.argv):
            days_back = int(sys.argv[idx + 1])

    # Get user_id from Supabase (needed for RLS)
    user_id = os.environ.get("SUPABASE_USER_ID", "")
    if not user_id:
        env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("SUPABASE_USER_ID="):
                        user_id = line.split("=", 1)[1].strip()

    if not user_id:
        print("⚠ SUPABASE_USER_ID not set in .env — will print data only")

    # Fetch data for each day
    rows = []
    today = datetime.now()
    for i in range(days_back):
        d = today - timedelta(days=i)
        date_str = d.strftime("%Y-%m-%d")
        row = parse_garmin_data(date_str)
        # Only include if we got at least one non-null value
        has_data = any(v is not None for k, v in row.items() if k not in ("date", "fetched_at"))
        if has_data:
            rows.append(row)

    if rows and user_id:
        upsert_to_supabase(rows, user_id)
    elif rows:
        print("\nData fetched but not uploaded (no SUPABASE_USER_ID):")
        for row in rows:
            vals = {k: v for k, v in row.items() if v is not None and k not in ("date", "fetched_at")}
            print(f"  {row['date']}: {vals}")
    else:
        print("\nNo data to sync.")

    # Print raw JSON for debugging (first day only)
    if "--debug" in sys.argv and days_back > 0:
        date_str = today.strftime("%Y-%m-%d")
        print(f"\n─── RAW JSON for {date_str} ───")
        print("HRV:", json.dumps(fetch_hrv(date_str), indent=2, default=str))
        print("Daily:", json.dumps(fetch_daily_summary(date_str), indent=2, default=str))
        print("Body Battery:", json.dumps(fetch_body_battery(date_str), indent=2, default=str))
        print("Training Readiness:", json.dumps(fetch_training_readiness(date_str), indent=2, default=str))
        print("Sleep:", json.dumps(fetch_sleep_data(date_str), indent=2, default=str))

if __name__ == "__main__":
    main()

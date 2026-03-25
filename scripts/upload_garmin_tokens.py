#!/usr/bin/env python3
"""
Upload garth OAuth tokens from ~/.garth to Supabase garmin_auth table.

Run this ONCE after authenticating with garmin_auth_v2.py.
The Edge Function will auto-refresh OAuth2 tokens using these OAuth1 credentials.

Usage:
  python scripts/upload_garmin_tokens.py
"""

import os
import json
import sys

# ─── Load tokens from ~/.garth ───
GARTH_DIR = os.path.expanduser("~/.garth")

oauth1_path = os.path.join(GARTH_DIR, "oauth1_token.json")
oauth2_path = os.path.join(GARTH_DIR, "oauth2_token.json")

if not os.path.exists(oauth1_path) or not os.path.exists(oauth2_path):
    print("x No garth tokens found at ~/.garth")
    print("  Run: python scripts/garmin_auth_v2.py")
    sys.exit(1)

with open(oauth1_path) as f:
    oauth1 = json.load(f)

with open(oauth2_path) as f:
    oauth2 = json.load(f)

print("OAuth1 token loaded")
print(f"  domain: {oauth1.get('domain', 'garmin.com')}")
print(f"  mfa_token: {'yes' if oauth1.get('mfa_token') else 'no'}")

print("OAuth2 token loaded")
print(f"  expires_at: {oauth2.get('expires_at')}")
print(f"  refresh_token_expires_at: {oauth2.get('refresh_token_expires_at')}")

import time
now = int(time.time())
exp = oauth2.get("expires_at", 0)
if exp < now:
    hours = (now - exp) // 3600
    print(f"  WARNING: access_token expired {hours}h ago (Edge Function will auto-refresh via OAuth1)")
else:
    hours = (exp - now) // 3600
    print(f"  access_token valid for {hours}h")

# ─── Load Supabase config ───
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_KEY:
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("SUPABASE_URL="):
                    SUPABASE_URL = line.split("=", 1)[1]
                elif line.startswith("SUPABASE_SERVICE_KEY="):
                    SUPABASE_KEY = line.split("=", 1)[1]

if not SUPABASE_URL or not SUPABASE_KEY:
    print("\nx SUPABASE_URL or SUPABASE_SERVICE_KEY not set")
    sys.exit(1)

# ─── Upload to Supabase ───
from supabase import create_client
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

row = {
    "id": "default",
    "oauth1_token": oauth1["oauth_token"],
    "oauth1_token_secret": oauth1["oauth_token_secret"],
    "mfa_token": oauth1.get("mfa_token"),
    "mfa_expiration_timestamp": str(oauth1.get("mfa_expiration_timestamp")) if oauth1.get("mfa_expiration_timestamp") else None,
    "domain": oauth1.get("domain", "garmin.com"),
    "oauth2_access_token": oauth2["access_token"],
    "oauth2_refresh_token": oauth2["refresh_token"],
    "oauth2_token_type": oauth2.get("token_type", "Bearer"),
    "oauth2_scope": oauth2.get("scope"),
    "oauth2_jti": oauth2.get("jti"),
    "oauth2_expires_at": oauth2["expires_at"],
    "oauth2_refresh_token_expires_at": oauth2["refresh_token_expires_at"],
    "updated_at": "now()",
}

try:
    sb.table("garmin_auth").upsert(row, on_conflict="id").execute()
    print(f"\nTokens uploaded to Supabase garmin_auth table")
    print("The Edge Function will auto-refresh OAuth2 when needed.")
except Exception as e:
    print(f"\nx Upload failed: {e}")
    sys.exit(1)

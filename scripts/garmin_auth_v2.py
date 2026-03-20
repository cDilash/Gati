#!/usr/bin/env python3
"""
Garmin Connect Auth v2 — uses garth with MFA support.
garth 0.7.11 handles MFA natively via the mobile SSO flow.
Timeout increased to 60s to handle slow Garmin responses.

Usage:
  python scripts/garmin_auth_v2.py
"""

import warnings
warnings.filterwarnings("ignore")
import os
os.environ["LOGFIRE_SEND_TO_LOGFIRE"] = "false"

import garth
import garth.http as garth_http
import garth.sso as sso
import getpass
import sys

def main():
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")

    # Increase timeout significantly
    garth_http.client.timeout = 60

    client_id = getattr(sso, 'CLIENT_ID', 'unknown')
    print(f"\ngarth {garth.__version__} · client_id={client_id}")
    print(f"Connecting to Garmin SSO (60s timeout)...\n")

    try:
        # Use return_on_mfa to handle MFA manually with better UX
        result = sso.login(email, password, return_on_mfa=True)

        if isinstance(result, tuple) and result[0] == "needs_mfa":
            mfa_state = result[1]
            mfa_method = mfa_state.get("mfa_method", "email")
            print(f"✓ Credentials accepted — MFA via {mfa_method}")
            mfa_code = input(f"Enter the MFA code from your {mfa_method}: ").strip()

            print("Submitting MFA code...")
            oauth1, oauth2 = sso.resume_login(mfa_state, mfa_code)
            garth_http.client.oauth1_token = oauth1
            garth_http.client.oauth2_token = oauth2
            garth.save("~/.garth")
            print(f"\n✓ Authenticated as {email}")
            print("  Tokens saved to ~/.garth")
            print("  These last ~1 year.")
            return

        # No MFA needed — direct success
        garth.save("~/.garth")
        print(f"\n✓ Authenticated as {email}")
        print("  Tokens saved to ~/.garth")
        print("  These last ~1 year.")

    except Exception as e:
        err = str(e)
        if "429" in err:
            print(f"\n✗ Rate limited (429). Wait 1 hour and try again.")
            print("  Do NOT retry — it extends the lockout.")
        elif "timed out" in err.lower() or "timeout" in err.lower():
            print(f"\n✗ Connection timed out.")
            print("  Garmin may be blocking this IP.")
            print("  Try: phone hotspot, or disable MFA temporarily.")
        else:
            print(f"\n✗ Failed: {err[:300]}")
        sys.exit(1)

if __name__ == "__main__":
    main()

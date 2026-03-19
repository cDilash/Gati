#!/usr/bin/env python3
"""
Garmin Connect Authentication — run ONCE to save OAuth tokens.
Tokens last ~1 year. Re-run only if you get auth errors.

Usage:
  python scripts/garmin_auth.py

If you get 429 (Too Many Requests), wait 1 hour before retrying.
Garmin aggressively rate-limits login attempts.
"""

import warnings
warnings.filterwarnings("ignore", message="Logfire API is unreachable")
import os
os.environ["LOGFIRE_SEND_TO_LOGFIRE"] = "false"

import garth
import getpass
import sys
import time

def main():
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")

    for attempt in range(2):
        try:
            garth.login(email, password)
            garth.save("~/.garth")
            print(f"\n✓ Authenticated as {email}")
            print("  Tokens saved to ~/.garth")
            print("  These last ~1 year. You won't need to login again.")
            return
        except Exception as e:
            err = str(e)
            if "429" in err:
                if attempt == 0:
                    print(f"\n⏳ Rate limited by Garmin. Waiting 60 seconds...")
                    time.sleep(60)
                    print("  Retrying...")
                    continue
                else:
                    print(f"\n✗ Still rate limited. Please wait 1 hour and try again.")
                    print("  Garmin aggressively rate-limits login attempts.")
                    print("  Do NOT retry repeatedly — it extends the lockout.")
                    sys.exit(1)
            else:
                print(f"\n✗ Authentication failed: {e}", file=sys.stderr)
                sys.exit(1)

if __name__ == "__main__":
    main()

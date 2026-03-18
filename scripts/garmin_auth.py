#!/usr/bin/env python3
"""
Garmin Connect Authentication — run ONCE to save OAuth tokens.
Tokens last ~1 year. Re-run only if you get auth errors.

Usage:
  python scripts/garmin_auth.py
"""

import garth
import getpass
import sys

def main():
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")

    try:
        garth.login(email, password)
        garth.save("~/.garth")
        print(f"\n✓ Authenticated as {email}")
        print("  Tokens saved to ~/.garth")
        print("  These last ~1 year. You won't need to login again.")
    except Exception as e:
        print(f"\n✗ Authentication failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

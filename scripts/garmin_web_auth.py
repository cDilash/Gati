#!/usr/bin/env python3
"""
Garmin Connect Web SSO Authentication.
Uses the web browser flow instead of the mobile API that garth uses.
Saves tokens in garth-compatible format to ~/.garth.

Usage:
  python scripts/garmin_web_auth.py
"""

import warnings
warnings.filterwarnings("ignore")
import os
os.environ["LOGFIRE_SEND_TO_LOGFIRE"] = "false"

import requests
import re
import json
import getpass
import sys
from pathlib import Path

SSO_BASE = "https://sso.garmin.com/sso"
CONNECT_BASE = "https://connect.garmin.com"
GCM_BASE = "https://connect.garmin.com/modern"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Origin": "https://sso.garmin.com",
    "Referer": "https://sso.garmin.com/sso/signin",
}

def main():
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")

    session = requests.Session()
    session.headers.update(HEADERS)

    print("\n1. Loading SSO page...")
    try:
        params = {
            "service": f"{GCM_BASE}",
            "webhost": f"{CONNECT_BASE}",
            "source": f"{GCM_BASE}",
            "redirectAfterAccountLoginUrl": f"{GCM_BASE}",
            "redirectAfterAccountCreationUrl": f"{GCM_BASE}",
            "gauthHost": SSO_BASE,
            "locale": "en_US",
            "id": "gauth-widget",
            "cssUrl": "https://static.garmincdn.com/com.garmin.connect/ui/css/gauth-custom-v1.2-min.css",
            "clientId": "GarminConnect",
            "rememberMeShown": "true",
            "rememberMeChecked": "false",
            "createAccountShown": "true",
            "openCreateAccount": "false",
            "displayNameShown": "false",
            "consumeServiceTicket": "false",
            "initialFocus": "true",
            "embedWidget": "false",
            "generateExtraServiceTicket": "true",
            "generateTwoExtraServiceTickets": "true",
            "generateNoServiceTicket": "false",
            "globalOptInShown": "true",
            "globalOptInChecked": "false",
            "mobile": "false",
        }
        resp = session.get(f"{SSO_BASE}/signin", params=params, timeout=15)
        if resp.status_code != 200:
            print(f"✗ SSO page returned {resp.status_code}")
            sys.exit(1)
        print(f"  ✓ SSO page loaded ({resp.status_code})")

        # Extract CSRF token
        csrf_match = re.search(r'name="_csrf"\s+value="([^"]+)"', resp.text)
        csrf_token = csrf_match.group(1) if csrf_match else ""
        if csrf_token:
            print(f"  ✓ CSRF token found")
        else:
            print(f"  ⚠ No CSRF token (may still work)")

    except Exception as e:
        print(f"✗ Failed to load SSO page: {e}")
        sys.exit(1)

    print("\n2. Submitting credentials...")
    try:
        login_data = {
            "username": email,
            "password": password,
            "embed": "false",
            "_csrf": csrf_token,
        }
        resp = session.post(
            f"{SSO_BASE}/signin",
            params=params,
            data=login_data,
            timeout=15,
        )

        # Check for ticket in response
        ticket_match = re.search(r'ticket=([A-Za-z0-9\-]+)', resp.text)
        if not ticket_match:
            ticket_match = re.search(r'ticket=([A-Za-z0-9\-]+)', resp.url)

        if not ticket_match:
            # Check redirect history for ticket
            for r in resp.history:
                ticket_match = re.search(r'ticket=([A-Za-z0-9\-]+)', r.url)
                if ticket_match:
                    break

        if not ticket_match:
            # Check for MFA redirect
            if "verifyMFA" in resp.url or "MfaCode" in resp.url:
                print(f"  ✓ Credentials accepted — MFA required")
                mfa_code = input("\n  Enter the MFA code from your email: ").strip()

                # Extract CSRF from MFA page
                mfa_csrf = ""
                csrf_match2 = re.search(r'name="_csrf"\s+value="([^"]+)"', resp.text)
                if csrf_match2:
                    mfa_csrf = csrf_match2.group(1)

                # Debug: dump the MFA form details
                form_match = re.search(r'<form[^>]*action="([^"]*)"[^>]*>', resp.text)
                form_action = form_match.group(1) if form_match else resp.url
                print(f"  Form action: {form_action[:120]}")

                # Find all input fields in the MFA form
                inputs = re.findall(r'<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"', resp.text)
                mfa_data = {name: value for name, value in inputs}
                mfa_data["verificationCode"] = mfa_code
                print(f"  Form fields: {list(mfa_data.keys())}")

                # Resolve form action URL
                if form_action.startswith("/"):
                    form_action = "https://sso.garmin.com" + form_action

                # Submit MFA code
                print(f"  Submitting MFA code to {form_action[:80]}...")
                resp = session.post(
                    form_action,
                    data=mfa_data,
                    timeout=15,
                )

                # Look for ticket after MFA
                ticket_match = re.search(r'ticket=([A-Za-z0-9\-]+)', resp.text)
                if not ticket_match:
                    ticket_match = re.search(r'ticket=([A-Za-z0-9\-]+)', resp.url)
                if not ticket_match:
                    for r in resp.history:
                        ticket_match = re.search(r'ticket=([A-Za-z0-9\-]+)', r.url)
                        if ticket_match:
                            break

                if not ticket_match:
                    # Debug: show what we got back
                    print(f"\n  DEBUG — Response URL: {resp.url[:200]}")
                    print(f"  DEBUG — Status: {resp.status_code}")
                    print(f"  DEBUG — Redirect history: {[r.url[:80] for r in resp.history]}")
                    # Look for error messages
                    err_match = re.search(r'class="error"[^>]*>([^<]+)', resp.text)
                    warn_match = re.search(r'class="warning"[^>]*>([^<]+)', resp.text)
                    status_match = re.search(r'"status":\s*"([^"]+)"', resp.text)
                    if err_match:
                        print(f"  Error: {err_match.group(1).strip()}")
                    if warn_match:
                        print(f"  Warning: {warn_match.group(1).strip()}")
                    if status_match:
                        print(f"  Status: {status_match.group(1)}")
                    # Dump a snippet of the page content
                    text = resp.text
                    # Find relevant text near "verification" or "code" or "error"
                    for keyword in ["error", "invalid", "expired", "success", "ticket", "verification"]:
                        idx = text.lower().find(keyword)
                        if idx >= 0:
                            snippet = text[max(0,idx-50):idx+100].replace('\n',' ').strip()
                            print(f"  Near '{keyword}': ...{snippet}...")
                    sys.exit(1)

            elif "locked" in resp.text.lower():
                print("✗ Account is locked. Wait and retry later.")
                sys.exit(1)
            elif "invalid" in resp.text.lower() or "incorrect" in resp.text.lower():
                print("✗ Invalid email or password.")
                sys.exit(1)
            else:
                print(f"✗ No ticket in response (status {resp.status_code})")
                print(f"  URL: {resp.url[:200]}")
                sys.exit(1)

        ticket = ticket_match.group(1)
        print(f"  ✓ Got service ticket: {ticket[:12]}...")

    except Exception as e:
        print(f"✗ Login failed: {e}")
        sys.exit(1)

    print("\n3. Exchanging ticket for session...")
    try:
        resp = session.get(
            f"{GCM_BASE}",
            params={"ticket": ticket},
            timeout=15,
        )
        print(f"  ✓ Session established ({resp.status_code})")

        # Now use garth to save tokens in compatible format
        # We'll use the session cookies to get OAuth tokens
        print("\n4. Getting OAuth tokens via garth...")

        import garth
        import garth.http as garth_http
        garth_http.client.timeout = 30

        # Transfer cookies from requests session to garth
        for cookie in session.cookies:
            garth_http.client.sess.cookies.set(
                cookie.name, cookie.value,
                domain=cookie.domain, path=cookie.path
            )

        # Try to get OAuth tokens using the authenticated session
        try:
            garth.login(email, password)
            garth.save("~/.garth")
            print("  ✓ OAuth tokens saved to ~/.garth")
            return
        except Exception as e2:
            print(f"  ⚠ garth token exchange failed: {e2}")
            print("  Saving session cookies as fallback...")

        # Fallback: save session cookies for direct API access
        cookie_path = Path.home() / ".garth" / "session_cookies.json"
        cookie_path.parent.mkdir(exist_ok=True)
        cookies = {c.name: c.value for c in session.cookies}
        cookie_path.write_text(json.dumps(cookies, indent=2))
        print(f"  ✓ Session cookies saved to {cookie_path}")
        print("  ⚠ These expire in ~24 hours. Use garmin_fetch.py --cookies mode.")

    except Exception as e:
        print(f"✗ Session exchange failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

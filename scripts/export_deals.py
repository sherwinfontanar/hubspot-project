
import csv
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT_DIR / ".env"
EXPORT_DIR = ROOT_DIR / "exports"
OUTPUT_FILE = EXPORT_DIR / "deals-last-7-days.csv"

API_URL = "https://api.hubapi.com/crm/v3/objects/deals/search"

PROPERTIES = [
    "dealname",
    "amount",
    "pipeline",
    "dealstage",
    "createdate",
    "order_id",
    "deal_currency_code",
]


def load_env_file():
    """Load key-value pairs from the root .env without printing secrets."""
    if not ENV_FILE.exists():
        raise FileNotFoundError(
            f".env file not found at {ENV_FILE}. Create it from .env.example."
        )

    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")

        if key and value and key not in os.environ:
            os.environ[key] = value


def hubspot_search(token, payload):
    """Search HubSpot deals, retrying temporary rate-limit/server errors."""
    body = json.dumps(payload).encode("utf-8")

    for attempt in range(4):
        request = Request(
            API_URL,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )

        try:
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))

        except HTTPError as exc:
            if exc.code == 429 or 500 <= exc.code <= 599:
                if attempt < 3:
                    retry_after = exc.headers.get("Retry-After")
                    try:
                        delay = min(max(float(retry_after), 1), 30)
                    except (TypeError, ValueError):
                        delay = min(2 ** attempt, 8)

                    time.sleep(delay)
                    continue

            details = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(
                f"HubSpot API returned HTTP {exc.code}: {details}"
            ) from exc

        except URLError as exc:
            if attempt < 3:
                time.sleep(min(2 ** attempt, 8))
                continue
            raise RuntimeError(f"Could not connect to HubSpot: {exc}") from exc

    raise RuntimeError("HubSpot request failed after retries.")


def export_deals():
    load_env_file()

    token = os.environ.get("HUBSPOT_ACCESS_TOKEN")
    if not token or token == "replace_with_your_private_app_token":
        raise RuntimeError(
            "HUBSPOT_ACCESS_TOKEN is missing. Check the root .env file."
        )

    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)
    cutoff_ms = int(seven_days_ago.timestamp() * 1000)

    deals = []
    after = None

    while True:
        payload = {
            "filterGroups": [
                {
                    "filters": [
                        {
                            "propertyName": "createdate",
                            "operator": "GTE",
                            "value": str(cutoff_ms),
                        }
                    ]
                }
            ],
            "properties": PROPERTIES,
            "sorts": ["createdate"],
            "limit": 100,
        }

        if after is not None:
            payload["after"] = after

        result = hubspot_search(token, payload)
        deals.extend(result.get("results", []))

        next_page = result.get("paging", {}).get("next")
        if not next_page:
            break

        after = next_page.get("after")
        if after is None:
            break

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    columns = ["deal_id"] + PROPERTIES

    with OUTPUT_FILE.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=columns)
        writer.writeheader()

        for deal in deals:
            properties = deal.get("properties", {})
            row = {"deal_id": deal.get("id", "")}
            row.update({name: properties.get(name, "") for name in PROPERTIES})
            writer.writerow(row)

    print(f"Export complete: {OUTPUT_FILE}")
    print(f"Deals exported: {len(deals)}")
    print("Date range: last 7 days (UTC)")


if __name__ == "__main__":
    try:
        export_deals()
    except (RuntimeError, FileNotFoundError, OSError, json.JSONDecodeError) as exc:
        print(f"Export failed: {exc}")
        raise SystemExit(1)

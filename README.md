# HubSpot Order Sync

A full-stack integration that receives e-commerce order-created webhooks, synchronizes orders to HubSpot CRM, tracks sync attempts in SQLite, and provides a dashboard for monitoring and retrying failed synchronizations.

## Features

- Receives and validates order-created webhook payloads.
- Authenticates incoming webhooks using a shared secret.
- Finds an existing HubSpot Contact by email or creates one when missing.
- Creates a HubSpot Deal linked to the Contact.
- Uses the order ID to prevent duplicate order processing.
- Retries temporary HubSpot API failures, including rate limits and server errors.
- Persists synchronization status, attempts, errors, and HubSpot record IDs in SQLite.
- Displays recent synchronization attempts and allows manual retries for failed records.
- Exports HubSpot Deals created within the last seven days to CSV using Python.

## Technology Stack

- **Backend:** Node.js, TypeScript, Express
- **CRM:** HubSpot CRM API
- **Database:** SQLite with better-sqlite3
- **Frontend:** React, TypeScript, Vite
- **Export:** Python standard library
- **Testing:** Vitest and Supertest

## Prerequisites

- Node.js and npm
- Python 3
- A HubSpot developer/test account
- A HubSpot private app with the required CRM permissions

## Configuration

Create a root `.env` file based on `.env.example` and configure the following values:

```env
PORT=3000
NODE_ENV=development
DATABASE_PATH=./data/orders.db
WEBHOOK_SECRET=replace_with_a_local_test_secret
HUBSPOT_ACCESS_TOKEN=your_private_app_access_token
HUBSPOT_PIPELINE_ID=default
HUBSPOT_DEAL_STAGE_ID=appointmentscheduled
```

Configure the token locally. **Do not commit `.env` or share the private app access token.**

The HubSpot private app needs permissions to read and write Contacts and Deals, read Deal schema, and access currency settings if required by your configuration.

## Running the Application

### 1. Start the backend

Open a terminal:

```powershell
cd backend
npm install
npm run dev
```

The backend runs at `http://localhost:3000`.

Check the health endpoint:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

### 2. Start the frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

The frontend proxies `/api` requests to the backend.

## Webhook

**Endpoint:** `POST /webhooks/orders`

The endpoint authenticates requests using an HMAC-SHA256 signature. Send the signature in the `x-webhook-signature` header using the format `sha256=<hex digest>`. The signature is calculated from the exact JSON request body and the `WEBHOOK_SECRET` configured in the root `.env` file.

Example payload:

```json
{
  "event": "order.created",
  "order_id": "ORD-10482",
  "created_at": "2026-09-20T14:32:00+08:00",
  "customer": {
    "email": "maria.santos@example.com",
    "first_name": "Maria",
    "last_name": "Santos",
    "phone": "+639171234567"
  },
  "items": [
    {
      "sku": "TSH-BLK-M",
      "name": "Black Tee (M)",
      "qty": 2,
      "price": 450.00
    }
  ],
  "currency": "PHP",
  "total": 900.00
}
```

### Send a test request using PowerShell

Run this example from the project root while the backend is running. Replace the placeholder secret with your local `WEBHOOK_SECRET`. Do not commit the actual secret.

```powershell
$secret = "YOUR_LOCAL_WEBHOOK_SECRET"

$body = @'
{
  "event": "order.created",
  "order_id": "ORD-10482",
  "created_at": "2026-09-20T14:32:00+08:00",
  "customer": {
    "email": "maria.santos@example.com",
    "first_name": "Maria",
    "last_name": "Santos",
    "phone": "+639171234567"
  },
  "items": [
    {
      "sku": "TSH-BLK-M",
      "name": "Black Tee (M)",
      "qty": 2,
      "price": 450.00
    }
  ],
  "currency": "PHP",
  "total": 900.00
}
'@

$keyBytes = [System.Text.Encoding]::UTF8.GetBytes($secret)
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$hmac = [System.Security.Cryptography.HMACSHA256]::new($keyBytes)

try {
    $hashBytes = $hmac.ComputeHash($bodyBytes)
    $signature = [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()

    $headers = @{
        "Content-Type" = "application/json"
        "x-webhook-signature" = "sha256=$signature"
    }

    Invoke-RestMethod `
        -Method Post `
        -Uri "http://localhost:3000/webhooks/orders" `
        -Headers $headers `
        -Body $body
}
finally {
    $hmac.Dispose()
}
```

A successful request should return a response indicating that the order was accepted or already recorded. The request uses a sample order ID, so subsequent requests may be treated as duplicates.

The webhook validates the signature and payload before processing the order. Duplicate order IDs are handled idempotently to prevent creating duplicate Deals.

## Dashboard API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/attempts` | Retrieve recent sync attempts |
| POST | `/api/attempts/:id/retry` | Retry a failed synchronization |

The dashboard displays order IDs, statuses, attempt counts, HubSpot Contact and Deal IDs, timestamps, and retry controls for failed records.


## Dashboard API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/attempts` | Retrieve recent sync attempts |
| POST | `/api/attempts/:id/retry` | Retry a failed synchronization |

The dashboard displays order IDs, statuses, attempt counts, HubSpot Contact and Deal IDs, timestamps, and retry controls for failed records.

## Run Tests and Checks

From the backend directory:

```powershell
npm test
npm run typecheck
```

From the frontend directory:

```powershell
npm run lint
npm run build
```

## Export Deals to CSV

From the project root, run:

```powershell
python scripts/export_deals.py
```

The script searches HubSpot for Deals created within the last seven days, handles pagination, and writes the results to:

`exports/deals-last-7-days.csv`

The export includes the Deal ID, name, amount, pipeline, stage, creation date, order ID, and currency.

## Database and Sync Behavior

The SQLite database stores order synchronization records and their payloads. Records track statuses such as `pending`, `processing`, `success`, and `failed`, along with attempt counts and any error messages.

Temporary HubSpot rate-limit and server errors are retried. Failed records can be retried through the dashboard API when their stored payload is available.

## Currency Configuration

Deal currency must be supported by the HubSpot account's currency configuration. If a requested currency is not supported, the integration should report the failure rather than silently converting the order amount or changing its currency.

## Security Notes

- Keep the root `.env` file private.
- Do not commit HubSpot access tokens or webhook secrets.
- Use a dedicated test portal for integration testing.
- Use HTTPS and a securely managed webhook secret in production.
- Review and restrict API permissions according to deployment requirements.

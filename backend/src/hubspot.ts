
const HUBSPOT_BASE_URL = "https://api.hubapi.com";

export class HubSpotError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HubSpotError";
  }
}

function getAccessToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not configured.");
  return token;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce<T>(
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${HUBSPOT_BASE_URL}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const retryAfterMs = retryAfter
      ? Number(retryAfter) * 1000
      : undefined;

    // Do not include credentials or request headers in error messages.
    const responseText = (await response.text()).slice(0, 500);

    throw new HubSpotError(
      `HubSpot returned HTTP ${response.status}: ${responseText}`,
      response.status,
      retryAfterMs,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function hubspotRequest<T>(
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  const maxAttempts = 4;

  for (let attempt = 1; ; attempt++) {
    try {
      return await requestOnce<T>(endpoint, init);
    } catch (error) {
      const retryable =
        error instanceof HubSpotError &&
        (error.status === 429 || error.status >= 500);

      if (!retryable || attempt >= maxAttempts) throw error;

      const exponentialDelay = Math.min(1000 * 2 ** (attempt - 1), 8000);
      const waitMs = Math.min(
        Math.max(error.retryAfterMs ?? exponentialDelay, 250),
        30000,
      );

      await delay(waitMs);
    }
  }
}

type HubSpotObject = {
  id: string;
  properties: Record<string, string | null>;
};

type SearchResult = {
  results: HubSpotObject[];
};

export type ContactInput = {
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
};

export type DealInput = {
  order_id: string;
  dealname: string;
  amount: string;
  currency: string;
  created_at: string;
};

export async function findContactByEmail(
  email: string,
): Promise<HubSpotObject | undefined> {
  const result = await hubspotRequest<SearchResult>(
    "/crm/v3/objects/contacts/search",
    {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: "email",
            operator: "EQ",
            value: email,
          }],
        }],
        properties: ["email", "firstname", "lastname", "phone"],
        limit: 1,
      }),
    },
  );

  return result.results[0];
}

export async function createContact(
  contact: ContactInput,
): Promise<HubSpotObject> {
  const properties: Record<string, string> = {
    email: contact.email,
    firstname: contact.first_name,
    lastname: contact.last_name,
  };

  if (contact.phone) properties.phone = contact.phone;

  return hubspotRequest<HubSpotObject>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
}


export async function updateContact(
  contactId: string,
  contact: ContactInput,
): Promise<HubSpotObject> {
  const properties: Record<string, string> = {
    firstname: contact.first_name,
    lastname: contact.last_name,
  };

  // Only update the phone when the order provides one.
  // This avoids clearing an existing phone number when omitted.
  if (contact.phone) {
    properties.phone = contact.phone;
  }

  return hubspotRequest<HubSpotObject>(
    `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    },
  );
}

export async function findDealByOrderId(
  orderId: string,
): Promise<HubSpotObject | undefined> {
  const result = await hubspotRequest<SearchResult>(
    "/crm/v3/objects/deals/search",
    {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: "order_id",
            operator: "EQ",
            value: orderId,
          }],
        }],
        properties: [
          "dealname",
          "amount",
          "pipeline",
          "dealstage",
          "order_id",
        ],
        limit: 1,
      }),
    },
  );

  return result.results[0];
}

export async function createDeal(
  deal: DealInput,
): Promise<HubSpotObject> {
  const pipeline = process.env.HUBSPOT_PIPELINE_ID ?? "default";
  const dealstage = process.env.HUBSPOT_DEAL_STAGE_ID;

  if (!dealstage) {
    throw new Error("HUBSPOT_DEAL_STAGE_ID is not configured.");
  }

  return hubspotRequest<HubSpotObject>("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        dealname: deal.dealname,
        amount: deal.amount,
        pipeline,
        dealstage,
        order_id: deal.order_id,
        // This project uses the order creation time as the deal close date.
        // This is an assessment assumption, not necessarily the real close date.
        closedate: new Date(deal.created_at).toISOString(),
        deal_currency_code: deal.currency,
      },
    }),
  });
}

export async function associateDealWithContact(
  dealId: string,
  contactId: string,
): Promise<void> {
  await hubspotRequest<void>(
    `/crm/v3/objects/deals/${encodeURIComponent(dealId)}/associations/contacts/${encodeURIComponent(contactId)}/3`,
    { method: "PUT" },
  );
}

export async function checkHubSpotConnection(): Promise<{
  connected: boolean;
  portalId?: number;
}> {
  const result = await hubspotRequest<{ portalId: number }>(
    "/integrations/v1/me",
  );

  return { connected: true, portalId: result.portalId };
}

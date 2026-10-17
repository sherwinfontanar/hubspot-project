
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hubspotMocks = vi.hoisted(() => ({
  findContactByEmail: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  findDealByOrderId: vi.fn(),
  createDeal: vi.fn(),
  associateDealWithContact: vi.fn(),
}));

vi.mock("./hubspot.js", () => ({
  ...hubspotMocks,
  HubSpotError: class HubSpotError extends Error {
    constructor(
      message: string,
      public status: number,
      public retryAfterMs?: number,
    ) {
      super(message);
    }
  },
}));

import db from "./database.js";
import { syncOrder } from "./order-sync.js";
import type { OrderPayload } from "./order-schema.js";

const testOrder: OrderPayload = {
  event: "order.created",
  order_id: "ORD-UNIT-RETRY-001",
  created_at: "2026-10-15T20:00:00Z",
  customer: {
    email: "unit.retry@example.com",
    first_name: "Unit",
    last_name: "Retry",
  },
  items: [
    {
      sku: "UNIT-001",
      name: "Unit Test Item",
      qty: 1,
      price: 10,
    },
  ],
  currency: "USD",
  total: 10,
};

describe("syncOrder retry handling", () => {
  beforeEach(() => {
  vi.clearAllMocks();

  for (const orderId of [
    testOrder.order_id,
    "ORD-MAPPING-001",
    "ORD-CONTACT-REUSE-001",
    "ORD-IDEMPOTENCY-001",
  ]) {
    db.prepare("DELETE FROM sync_attempts WHERE order_id = ?").run(orderId);
  }

  hubspotMocks.findContactByEmail.mockResolvedValue({
    id: "contact-test-1",
    properties: {},
  });

  hubspotMocks.updateContact.mockImplementation(
  async (contactId: string) => ({
    id: contactId,
    properties: {},
  }),
);

  hubspotMocks.findDealByOrderId.mockResolvedValue({
    id: "deal-test-1",
    properties: {},
  });

  hubspotMocks.associateDealWithContact.mockResolvedValue(undefined);
});

  afterEach(() => {
  for (const orderId of [
    testOrder.order_id,
    "ORD-MAPPING-001",
    "ORD-CONTACT-REUSE-001",
    "ORD-IDEMPOTENCY-001",
  ]) {
    db.prepare("DELETE FROM sync_attempts WHERE order_id = ?").run(orderId);
  }
});

  
  it("maps an order to a HubSpot Deal with the correct amount and currency", async () => {
    const order: OrderPayload = {
      ...testOrder,
      order_id: "ORD-MAPPING-001",
      currency: "PHP",
      total: 900,
    };

    hubspotMocks.findDealByOrderId.mockResolvedValueOnce(null);
    hubspotMocks.createDeal.mockResolvedValueOnce({
      id: "deal-mapping-1",
      properties: {},
    });

    const result = await syncOrder(order);

    expect(hubspotMocks.createDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: "ORD-MAPPING-001",
        dealname: "Order ORD-MAPPING-001",
        amount: "900.00",
        currency: "PHP",
        created_at: order.created_at,
      }),
    );

    expect(result.deal_id).toBe("deal-mapping-1");
  });

  it("updates an existing Contact without creating another one", async () => {
  const order: OrderPayload = {
    ...testOrder,
    order_id: "ORD-CONTACT-REUSE-001",
  };

  const existingContact = {
    id: "existing-contact-123",
    properties: { email: order.customer.email },
  };

  const updatedContact = {
    id: "existing-contact-123",
    properties: {
      email: order.customer.email,
      firstname: order.customer.first_name,
      lastname: order.customer.last_name,
    },
  };

  hubspotMocks.findContactByEmail.mockResolvedValueOnce(existingContact);
  hubspotMocks.updateContact.mockResolvedValueOnce(updatedContact);

  hubspotMocks.findDealByOrderId.mockResolvedValueOnce({
    id: "deal-contact-reuse-1",
    properties: {},
  });

  const result = await syncOrder(order);

  expect(hubspotMocks.findContactByEmail).toHaveBeenCalledWith(
    order.customer.email,
  );

  expect(hubspotMocks.updateContact).toHaveBeenCalledWith(
    "existing-contact-123",
    order.customer,
  );

  expect(hubspotMocks.createContact).not.toHaveBeenCalled();
  expect(result.contact_id).toBe("existing-contact-123");
});

  it("does not create duplicate Deals when an order is already synchronized", async () => {
    const order: OrderPayload = {
      ...testOrder,
      order_id: "ORD-IDEMPOTENCY-001",
    };

    // First request: no existing Deal, so create one.
    hubspotMocks.findDealByOrderId.mockResolvedValueOnce(null);
    hubspotMocks.createDeal.mockResolvedValueOnce({
      id: "deal-idempotency-1",
      properties: {},
    });

    const firstResult = await syncOrder(order);

    expect(firstResult.deal_id).toBe("deal-idempotency-1");
    expect(hubspotMocks.createDeal).toHaveBeenCalledTimes(1);

    // Second request: the order is already successful.
    await expect(syncOrder(order)).rejects.toThrow(
      "has already been synchronized",
    );

    // The duplicate request must not create another Deal or Contact.
    expect(hubspotMocks.createDeal).toHaveBeenCalledTimes(1);
    expect(hubspotMocks.createContact).not.toHaveBeenCalled();
  });

});

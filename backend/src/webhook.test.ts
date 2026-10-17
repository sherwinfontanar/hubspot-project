
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { AddressInfo } from "node:net";
import express from "express";
import webhookRouter from "./webhook.js";
import { vi } from "vitest";
import { createHmac } from "node:crypto";
import { jsonBodyParser } from "./json-body.js";


function signPayload(payload: unknown): string {
  return `sha256=${createHmac("sha256", "test_webhook_secret")
    .update(JSON.stringify(payload))
    .digest("hex")}`;
}


describe("Order webhook", () => {
  const app = express();
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.WEBHOOK_SECRET = "test_webhook_secret";
    app.use(jsonBodyParser);
    app.use("/webhooks", webhookRouter);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("rejects a request without a signature", async () => {
    const response = await request(baseUrl)
      .post("/webhooks/orders")
      .send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid webhook signature.");
  });

  
  it("rejects an invalid HMAC signature", async () => {
    const payload = { event: "order.created" };

    const response = await request(baseUrl) 
      .post("/webhooks/orders")
      .set("x-webhook-signature", `sha256=${"0".repeat(64)}`)
      .send(payload);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid webhook signature.");
  });

  it("rejects a payload modified after signing", async () => {
    const signedPayload = { event: "order.created", total: 10 };
    const modifiedPayload = { event: "order.created", total: 999 };

    const response = await request(baseUrl)
      .post("/webhooks/orders")
      .set("x-webhook-signature", signPayload(signedPayload))
      .send(modifiedPayload);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid webhook signature.");
  });


  it("rejects an invalid order payload", async () => {
    const payload = { event: "wrong.event" };

  const response = await request(baseUrl)
    .post("/webhooks/orders")
    .set("x-webhook-signature", signPayload(payload))
    .send(payload);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid order payload.");
  });
  

it("returns 200 when an order has already been synchronized", async () => {
  vi.spyOn(
    await import("./order-sync.js"),
    "syncOrder",
  ).mockRejectedValueOnce(
    new Error("Order ORD-DUPLICATE-001 has already been synchronized."),
  );

  const payload = {
    event: "order.created",
    order_id: "ORD-DUPLICATE-001",
    created_at: "2026-10-15T20:00:00Z",
    customer: {
      email: "duplicate@example.com",
      first_name: "Test",
      last_name: "Customer",
    },
    items: [
      {
        sku: "TEST-001",
        name: "Test Item",
        qty: 1,
        price: 10,
      },
    ],
    currency: "USD",
    total: 10,
  };

  const response = await request(baseUrl)
    .post("/webhooks/orders")
    .set("x-webhook-signature", signPayload(payload))
    .send(payload);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe("Order already synchronized.");
  expect(response.body.order_id).toBe("ORD-DUPLICATE-001");
  expect(response.body.status).toBe("success");

  vi.restoreAllMocks();
});

  
});

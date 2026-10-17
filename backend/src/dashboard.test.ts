
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import db from "./database.js";

vi.mock("./order-sync.js", () => ({
  syncOrder: vi.fn(),
}));

import { syncOrder } from "./order-sync.js";
import dashboardRouter from "./dashboard.js";

const app = express();
app.use(express.json());
app.use("/api", dashboardRouter);

const mockedSyncOrder = vi.mocked(syncOrder);

beforeAll(() => {
  db.prepare(`
    INSERT INTO sync_attempts (
      order_id, status, attempt_count, payload_json
    ) VALUES (?, 'success', 1, NULL)
    ON CONFLICT(order_id) DO NOTHING
  `).run("ORD-DASHBOARD-SUCCESS-TEST");

  db.prepare(`
    INSERT INTO sync_attempts (
      order_id, status, attempt_count, payload_json
    ) VALUES (?, 'failed', 1, NULL)
    ON CONFLICT(order_id) DO UPDATE SET
      status = 'failed',
      payload_json = NULL
  `).run("ORD-DASHBOARD-NO-PAYLOAD-TEST");
});

afterAll(() => {
  db.prepare(`
    DELETE FROM sync_attempts
    WHERE order_id IN (?, ?)
  `).run(
    "ORD-DASHBOARD-SUCCESS-TEST",
    "ORD-DASHBOARD-NO-PAYLOAD-TEST",
  );
});

describe("Dashboard API", () => {
  it("returns recent sync attempts", async () => {
    const response = await request(app).get("/api/attempts");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("count");
    expect(response.body).toHaveProperty("attempts");
    expect(response.body.attempts.length).toBeLessThanOrEqual(50);
  });

  it("does not retry a successful record", async () => {
    const record = db.prepare(`
      SELECT id FROM sync_attempts
      WHERE order_id = ?
    `).get("ORD-DASHBOARD-SUCCESS-TEST") as { id: number };

    const response = await request(app)
      .post(`/api/attempts/${record.id}/retry`);

    expect(response.status).toBe(409);
    expect(mockedSyncOrder).not.toHaveBeenCalled();
  });

  it("rejects a failed record without a saved payload", async () => {
    const record = db.prepare(`
      SELECT id FROM sync_attempts
      WHERE order_id = ?
    `).get("ORD-DASHBOARD-NO-PAYLOAD-TEST") as { id: number };

    const response = await request(app)
      .post(`/api/attempts/${record.id}/retry`);

    expect(response.status).toBe(422);
    expect(mockedSyncOrder).not.toHaveBeenCalled();
  });
});


import { Router } from "express";
import db from "./database.js";
import { orderSchema } from "./order-schema.js";
import { syncOrder } from "./order-sync.js";

const router = Router();

router.get("/attempts", (_req, res) => {
  const attempts = db.prepare(`
    SELECT
      id,
      order_id,
      status,
      attempt_count,
      contact_id,
      deal_id,
      error_message,
      created_at,
      updated_at
    FROM sync_attempts
    ORDER BY id DESC
    LIMIT 50
  `).all();

  return res.status(200).json({
    count: attempts.length,
    attempts,
  });
});

router.post("/attempts/:id/retry", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid attempt ID.",
    });
  }

  const attempt = db.prepare(`
    SELECT id, order_id, status, payload_json
    FROM sync_attempts
    WHERE id = ?
  `).get(id) as {
    id: number;
    order_id: string;
    status: string;
    payload_json: string | null;
  } | undefined;

  if (!attempt) {
    return res.status(404).json({
      error: "Sync attempt not found.",
    });
  }

  if (attempt.status !== "failed") {
    return res.status(409).json({
      error: "Only failed attempts can be retried.",
      order_id: attempt.order_id,
      status: attempt.status,
    });
  }

  if (!attempt.payload_json) {
    return res.status(422).json({
      error: "Cannot retry because the original order payload was not saved.",
      order_id: attempt.order_id,
    });
  }

  let savedPayload: unknown;

  try {
    savedPayload = JSON.parse(attempt.payload_json);
  } catch {
    return res.status(422).json({
      error: "The saved order payload is invalid JSON.",
      order_id: attempt.order_id,
    });
  }

  const parsed = orderSchema.safeParse(savedPayload);

  if (!parsed.success) {
    return res.status(422).json({
      error: "The saved order payload is invalid.",
      order_id: attempt.order_id,
    });
  }

  try {
    const result = await syncOrder(parsed.data);

    return res.status(200).json({
      message: "Order retry succeeded.",
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown synchronization error.";

    console.error(`Retry failed for ${attempt.order_id}:`, message);

    return res.status(502).json({
      error: "Order retry failed.",
      order_id: attempt.order_id,
      message,
    });
  }
});

export default router;

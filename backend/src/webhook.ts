
import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { orderSchema } from "./order-schema.js";
import { syncOrder } from "./order-sync.js";

const router = Router();

type RequestWithRawBody = Request & {
  rawBody?: Buffer;
};

function isValidSignature(
  signature: string | undefined,
  rawBody: Buffer | undefined,
  secret: string,
): boolean {
  if (!signature || !rawBody) return false;

  const suppliedHex = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : "";

  if (!/^[a-fA-F0-9]{64}$/.test(suppliedHex)) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest();

  const supplied = Buffer.from(suppliedHex, "hex");

  return supplied.length === expected.length &&
    timingSafeEqual(supplied, expected);
}


router.post("/orders", async (req, res) => {
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!expectedSecret) {
    console.error("WEBHOOK_SECRET is not configured.");
    return res.status(500).json({ error: "Webhook is not configured." });
  }

  const rawBody = (req as RequestWithRawBody).rawBody;

if (
  !isValidSignature(
    req.header("x-webhook-signature"),
    rawBody,
    expectedSecret,
  )
) {
  return res.status(401).json({ error: "Invalid webhook signature." });
}

  const parsed = orderSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid order payload.",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const order = parsed.data;

  try {
    const result = await syncOrder(order);

    return res.status(200).json({
      message: "Order synchronized successfully.",
      ...result,
    });
  } catch (error) {
    console.error("Order synchronization failed:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unknown synchronization error.";

    if (message.includes("already been synchronized")) {
      return res.status(200).json({
        message: "Order already synchronized.",
        order_id: order.order_id,
        status: "success",
      });
    }

    return res.status(502).json({
      error: "Order synchronization failed.",
      order_id: order.order_id,
      message,
    });
  }
});

export default router;

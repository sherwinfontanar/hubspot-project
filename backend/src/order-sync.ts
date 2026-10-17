
import db from "./database.js";
import type { OrderPayload } from "./order-schema.js";
import {
  associateDealWithContact,
  createContact,
  createDeal,
  findContactByEmail,
  findDealByOrderId,
  HubSpotError,
  updateContact,
} from "./hubspot.js";

type AttemptRow = {
  id: number;
  order_id: string;
  status: string;
  attempt_count: number;
};

const findAttempt = db.prepare(`
  SELECT id, order_id, status, attempt_count
  FROM sync_attempts
  WHERE order_id = ?
  ORDER BY id DESC
  LIMIT 1
`);

const markProcessing = db.prepare(`
  UPDATE sync_attempts
  SET status = 'processing',
      attempt_count = attempt_count + 1,
      error_message = NULL,
      updated_at = datetime('now')
  WHERE id = ?
    AND status IN ('pending', 'failed')
`);

const markSuccess = db.prepare(`
  UPDATE sync_attempts
  SET status = 'success',
      contact_id = ?,
      deal_id = ?,
      error_message = NULL,
      updated_at = datetime('now')
  WHERE id = ?
`);

const markFailed = db.prepare(`
  UPDATE sync_attempts
  SET status = 'failed',
      error_message = ?,
      updated_at = datetime('now')
  WHERE id = ?
`);


const createPendingAttempt = db.prepare(`
  INSERT INTO sync_attempts (order_id, status, attempt_count, payload_json)
  VALUES (?, 'pending', 0, ?)
  ON CONFLICT(order_id) DO NOTHING
`);


export type SyncResult = {
  order_id: string;
  status: "success";
  contact_id: string;
  deal_id: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof HubSpotError) {
    return error.message.slice(0, 1000);
  }

  return error instanceof Error
    ? error.message.slice(0, 1000)
    : "Unknown synchronization error";
}

export async function syncOrder(order: OrderPayload): Promise<SyncResult> {
  // Initialize the order record if this is its first delivery.
  // The unique order_id index prevents duplicate records.
  createPendingAttempt.run(order.order_id, JSON.stringify(order));

  const attempt = findAttempt.get(order.order_id) as
    | AttemptRow
    | undefined;

  if (!attempt) {
    throw new Error(
      `Could not initialize sync attempt for ${order.order_id}.`,
    );
  }

  // Atomically claim only pending or failed orders.
  // Concurrent requests cannot both claim the same order.
  const claim = markProcessing.run(attempt.id);

  if (claim.changes !== 1) {
    const current = findAttempt.get(order.order_id) as
      | AttemptRow
      | undefined;

    if (current?.status === "success") {
      throw new Error(
        `Order ${order.order_id} has already been synchronized.`,
      );
    }

    throw new Error(
      `Order ${order.order_id} is already being synchronized.`,
    );
  }

  try {
    // Find an existing Contact before creating one.
    let contact = await findContactByEmail(order.customer.email);

    if (contact) {
      // Keep existing HubSpot customer details up to date.
      contact = await updateContact(contact.id, order.customer);
    } else {
      try {
        contact = await createContact(order.customer);
      } catch (error) {
        // Another delivery may have created this Contact concurrently.
        contact = await findContactByEmail(order.customer.email);
        if (!contact) throw error;
      }
    }


    // Search by the unique source order ID before creating a Deal.
    let deal = await findDealByOrderId(order.order_id);

    if (!deal) {
      try {
        deal = await createDeal({
          order_id: order.order_id,
          dealname: `Order ${order.order_id}`,
          amount: order.total.toFixed(2),
          currency: order.currency.toUpperCase(),
          created_at: order.created_at,
        });
      } catch (error) {
        // Recover if the create response was lost or a duplicate was rejected.
        deal = await findDealByOrderId(order.order_id);
        if (!deal) throw error;
      }
    }

    // Association may be retried if the association request fails.
    await associateDealWithContact(deal.id, contact.id);

    markSuccess.run(contact.id, deal.id, attempt.id);

    return {
      order_id: order.order_id,
      status: "success",
      contact_id: contact.id,
      deal_id: deal.id,
    };
  } catch (error) {
    markFailed.run(errorMessage(error), attempt.id);
    throw error;
  }
}

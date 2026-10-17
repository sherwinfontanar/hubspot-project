import { z } from "zod";

export const orderSchema = z.object({
  event: z.literal("order.created"),
  order_id: z.string().trim().min(1),
  created_at: z.string().datetime({ offset: true }),
  customer: z.object({
    email: z.string().email(),
    first_name: z.string().trim().min(1),
    last_name: z.string().trim().min(1),
    phone: z.string().optional(),
  }),
  items: z.array(
    z.object({
      sku: z.string().trim().min(1),
      name: z.string().trim().min(1),
      qty: z.number().int().positive(),
      price: z.number().nonnegative(),
    }),
  ).min(1),
  currency: z.string().length(3),
  total: z.number().nonnegative(),
});

export type OrderPayload = z.infer<typeof orderSchema>;

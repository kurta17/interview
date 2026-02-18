import { desc, eq } from "drizzle-orm";
import { type PaymentStatus, payments } from "#api/databases/schema.ts";
import type { AppContext } from "#api/primitives/app-context.ts";

/**
 * Get a payment by ID. Returns the payment if found, null otherwise.
 */
export async function getPaymentById(ctx: AppContext, paymentId: string) {
	const payment = await ctx.container.db
		.select()
		.from(payments)
		.where(eq(payments.id, paymentId))
		.limit(1)
		.then((rows) => rows[0]);

	return payment ?? null;
}

/**
 * Create a new payment. Amount should be in cents (e.g. $10.00 = 1000).
 */
export async function createPayment(
	ctx: AppContext,
	data: {
		amount: number; // in cents
		currency?: string;
		recipientEmail: string;
		description?: string;
		createdBy: string; // user ID
	},
) {
	const [payment] = await ctx.container.db
		.insert(payments)
		.values(data)
		.returning();
	return payment;
}

/**
 * List all payments for a user, newest first.
 */
export async function listPayments(ctx: AppContext, userId: string) {
	const result = await ctx.container.db
		.select()
		.from(payments)
		.where(eq(payments.createdBy, userId))
		.orderBy(desc(payments.createdAt));

	return result;
}

/**
 * Update a payment's status and record the webhook ID for idempotency.
 */
export async function updatePaymentStatus(
	ctx: AppContext,
	paymentId: string,
	status: PaymentStatus,
	webhookId: string,
) {
	const [updated] = await ctx.container.db
		.update(payments)
		.set({ status, lastWebhookId: webhookId })
		.where(eq(payments.id, paymentId))
		.returning();
	return updated ?? null;
}

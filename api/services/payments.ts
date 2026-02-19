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
 * Create a new payment and send it to the best provider.
 *
 * The flow:
 * 1. Pick the best provider via PaymentRouter (based on currency, etc.)
 * 2. Save to OUR database first (status: "pending") — so we have a record
 *    even if the provider call fails
 * 3. Send to the provider's API (Stripe, Adyen, etc.)
 * 4. Update our record with the provider's payment ID and status
 *
 * Why save to DB before calling the provider?
 * If the provider call fails (network error, timeout), we still have a
 * record of the attempted payment. We can retry later or show the user
 * that something went wrong. Without this, the payment would be lost.
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
	const currency = data.currency ?? "USD";

	// Step 1: Pick the best provider for this currency.
	// e.g. USD → Stripe, SGD → Adyen
	const provider = ctx.container.paymentRouter.selectProvider({
		currency,
		amount: data.amount,
	});

	// Step 2: Save to OUR database first as "pending".
	// This guarantees we have a record even if the provider call fails.
	const [payment] = await ctx.container.db
		.insert(payments)
		.values({ ...data, currency, status: "pending" as const })
		.returning();

	// Step 3: Send to the provider's API.
	try {
		const providerResult = await provider.createPayment({
			amount: data.amount,
			currency,
			recipientEmail: data.recipientEmail,
			description: data.description,
		});

		// Step 4: Update our record with the provider's response.
		// Store providerPaymentId so we can match webhooks later.
		const [updated] = await ctx.container.db
			.update(payments)
			.set({ status: providerResult.status })
			.where(eq(payments.id, payment.id))
			.returning();

		return updated;
	} catch (error) {
		// Provider call failed — mark as "failed" but don't throw.
		// The payment record exists so the user can see it failed.
		await ctx.container.db
			.update(payments)
			.set({ status: "failed" as const })
			.where(eq(payments.id, payment.id));

		return payment;
	}
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

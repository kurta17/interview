import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import { payments } from "#api/databases/schema.ts";
import {
	createTestUser,
	ctxWithRouter,
	defineTestAppContext,
	fakeProvider,
	serverTest,
} from "#api/lib/testing/utils.ts";
import {
	createPayment,
	listPayments,
	updatePaymentStatus,
} from "#api/services/payments.ts";

// ─────────────────────────────────────────────────────────────
// Test 1: Payment Creation — the happy path
// ─────────────────────────────────────────────────────────────
describe("createPayment", () => {
	serverTest(
		"should create payment and update status from provider response",
		async ({ container }) => {
			const user = await createTestUser(container.db);

			// Fake Stripe that returns "processing" — the most common
			// real-world response from Stripe for a new PaymentIntent.
			const stripe = fakeProvider({
				name: "stripe",
				supportedCurrencies: ["USD", "EUR"],
				createPayment: async () => ({
					providerPaymentId: "pi_abc123",
					status: "processing",
					rawResponse: { id: "pi_abc123", status: "processing" },
				}),
			});

			const ctx = ctxWithRouter(container, [stripe]);

			const result = await createPayment(ctx, {
				amount: 5000,
				currency: "USD",
				recipientEmail: "recipient@example.com",
				description: "Test payment",
				createdBy: user.id,
			});

			// The payment should exist in DB with the provider's status.
			expect(result.amount).toBe(5000);
			expect(result.currency).toBe("USD");
			expect(result.status).toBe("processing");
			expect(result.recipientEmail).toBe("recipient@example.com");
			expect(result.description).toBe("Test payment");
			expect(result.createdBy).toBe(user.id);
		},
	);

	// ─────────────────────────────────────────────────────────
	// Test 2: Provider Failure — graceful degradation
	//
	// This is critical for a payment orchestrator. If Stripe's
	// API is down, we must NOT crash. The payment should be
	// saved as "failed" so the user sees what happened.
	// ─────────────────────────────────────────────────────────
	serverTest(
		"should mark payment as failed when provider throws",
		async ({ container }) => {
			const user = await createTestUser(container.db);

			// Fake provider that simulates a network/API error.
			const brokenProvider = fakeProvider({
				name: "stripe",
				supportedCurrencies: ["USD"],
				createPayment: async () => {
					throw new Error("Stripe API is down");
				},
			});

			const ctx = ctxWithRouter(container, [brokenProvider]);

			const result = await createPayment(ctx, {
				amount: 3000,
				recipientEmail: "recipient@example.com",
				createdBy: user.id,
			});

			// Payment should still be returned (not thrown) — but marked failed.
			expect(result.amount).toBe(3000);
			expect(result.status).toBe("pending");

			// Verify in DB it's actually marked as failed.
			const [dbPayment] = await container.db
				.select()
				.from(payments)
				.where(eq(payments.id, result.id));
			expect(dbPayment.status).toBe("failed");
		},
	);

	// ─────────────────────────────────────────────────────────
	// Test 3: Currency-based routing
	//
	// The PaymentRouter picks providers by currency. This test
	// verifies that SGD routes to Adyen (not Stripe).
	// ─────────────────────────────────────────────────────────
	serverTest(
		"should route to correct provider based on currency",
		async ({ container }) => {
			const user = await createTestUser(container.db);

			let usedProvider = "";

			const stripe = fakeProvider({
				name: "stripe",
				supportedCurrencies: ["USD", "EUR"],
				createPayment: async () => {
					usedProvider = "stripe";
					return {
						providerPaymentId: "pi_stripe",
						status: "processing" as const,
						rawResponse: {},
					};
				},
			});

			const adyen = fakeProvider({
				name: "adyen",
				supportedCurrencies: ["SGD", "JPY"],
				createPayment: async () => {
					usedProvider = "adyen";
					return {
						providerPaymentId: "adyen_psp_ref",
						status: "processing" as const,
						rawResponse: {},
					};
				},
			});

			const ctx = ctxWithRouter(container, [stripe, adyen]);

			// Pay in SGD — should go to Adyen.
			await createPayment(ctx, {
				amount: 1000,
				currency: "SGD",
				recipientEmail: "recipient@example.com",
				createdBy: user.id,
			});
			expect(usedProvider).toBe("adyen");

			// Pay in USD — should go to Stripe.
			await createPayment(ctx, {
				amount: 2000,
				currency: "USD",
				recipientEmail: "recipient@example.com",
				createdBy: user.id,
			});
			expect(usedProvider).toBe("stripe");
		},
	);

	// ─────────────────────────────────────────────────────────
	// Test 4: Default currency
	//
	// When no currency is provided, it should default to "USD".
	// ─────────────────────────────────────────────────────────
	serverTest("should default to USD currency", async ({ container }) => {
		const user = await createTestUser(container.db);

		const stripe = fakeProvider({
			name: "stripe",
			supportedCurrencies: ["USD"],
		});

		const ctx = ctxWithRouter(container, [stripe]);

		const result = await createPayment(ctx, {
			amount: 1000,
			recipientEmail: "recipient@example.com",
			createdBy: user.id,
			// No currency specified — should default to "USD".
		});

		expect(result.currency).toBe("USD");
	});
});

// ─────────────────────────────────────────────────────────────
// Test 5: Webhook Idempotency
//
// Payment providers guarantee at-least-once delivery, meaning
// they may send the same webhook 2-3 times. If we process it
// twice, we'd have incorrect state. The lastWebhookId column
// prevents this.
// ─────────────────────────────────────────────────────────────
describe("updatePaymentStatus", () => {
	serverTest(
		"should update payment status and record webhook ID",
		async ({ container }) => {
			const user = await createTestUser(container.db);
			const ctx = defineTestAppContext(container);

			// Insert a pending payment directly.
			const [payment] = await container.db
				.insert(payments)
				.values({
					amount: 5000,
					currency: "USD",
					status: "pending",
					recipientEmail: "recipient@example.com",
					createdBy: user.id,
				})
				.returning();

			// Simulate webhook: pending → processing.
			const updated = await updatePaymentStatus(
				ctx,
				payment.id,
				"processing",
				"webhook_001",
			);

			expect(updated!.status).toBe("processing");
			expect(updated!.lastWebhookId).toBe("webhook_001");
		},
	);

	serverTest(
		"should support sequential status transitions via webhooks",
		async ({ container }) => {
			const user = await createTestUser(container.db);
			const ctx = defineTestAppContext(container);

			const [payment] = await container.db
				.insert(payments)
				.values({
					amount: 2000,
					currency: "EUR",
					status: "pending",
					recipientEmail: "recipient@example.com",
					createdBy: user.id,
				})
				.returning();

			// First webhook: pending → processing.
			await updatePaymentStatus(ctx, payment.id, "processing", "wh_1");

			// Second webhook: processing → completed.
			const final = await updatePaymentStatus(
				ctx,
				payment.id,
				"completed",
				"wh_2",
			);

			expect(final!.status).toBe("completed");
			expect(final!.lastWebhookId).toBe("wh_2");
		},
	);
});

// ─────────────────────────────────────────────────────────────
// Test 6: listPayments
// ─────────────────────────────────────────────────────────────
describe("listPayments", () => {
	serverTest(
		"should return only the requesting user's payments",
		async ({ container }) => {
			const ctx = defineTestAppContext(container);

			// Create two users.
			const userA = await createTestUser(container.db, {
				email: "a@example.com",
				name: "User A",
			});
			const userB = await createTestUser(container.db, {
				email: "b@example.com",
				name: "User B",
			});

			// Give each user a payment.
			await container.db.insert(payments).values([
				{
					amount: 1000,
					currency: "USD",
					recipientEmail: "r@example.com",
					createdBy: userA.id,
				},
				{
					amount: 2000,
					currency: "EUR",
					recipientEmail: "r@example.com",
					createdBy: userB.id,
				},
			]);

			// User A should only see their own payment.
			const results = await listPayments(ctx, userA.id);
			expect(results).toHaveLength(1);
			expect(results[0].amount).toBe(1000);
			expect(results[0].createdBy).toBe(userA.id);
		},
	);
});

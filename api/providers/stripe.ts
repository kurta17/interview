import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, PaymentProviderResult } from "./types.ts";

/**
 * Stripe payment provider implementation.
 *
 * Stripe API docs: https://stripe.com/docs/api/payment_intents
 *
 * Stripe uses:
 * - Bearer token auth (Authorization: Bearer sk_xxx)
 * - form-urlencoded request bodies (not JSON!)
 * - "sha256=" prefixed HMAC signatures on webhooks
 */
export class StripeProvider implements PaymentProvider {
	readonly name = "stripe";
	readonly supportedCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD"];

	constructor(
		/** Stripe secret key (sk_live_xxx or sk_test_xxx). */
		private readonly apiKey: string,
		/** Stripe webhook signing secret (whsec_xxx). */
		private readonly webhookSecret: string,
	) {}

	/**
	 * Create a PaymentIntent via Stripe's API.
	 *
	 * We use PaymentIntents (not Charges) because it's Stripe's recommended
	 * approach — it supports SCA (Strong Customer Authentication) required
	 * in Europe and handles async payment methods.
	 */
	async createPayment(data: {
		amount: number;
		currency: string;
		recipientEmail: string;
		description?: string;
	}): Promise<PaymentProviderResult> {
		// Stripe uses form-urlencoded, NOT JSON.
		// This is a quirk of Stripe's API — most other providers use JSON.
		const body = new URLSearchParams({
			amount: String(data.amount),
			currency: data.currency.toLowerCase(), // Stripe requires lowercase
			receipt_email: data.recipientEmail,
			// "automatic_payment_methods[enabled]" tells Stripe to accept
			// whatever payment methods are enabled in your Stripe dashboard.
			"automatic_payment_methods[enabled]": "true",
		});

		// Only add description if provided — Stripe doesn't like empty strings.
		if (data.description) {
			body.set("description", data.description);
		}

		const response = await fetch("https://api.stripe.com/v1/payment_intents", {
			method: "POST",
			headers: {
				// Stripe authenticates via Bearer token, not X-Api-Key.
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
		});

		const result = await response.json();

		// If Stripe returns an error, throw so the service layer can handle it.
		if (!response.ok) {
			throw new Error(
				`Stripe API error: ${result.error?.message ?? response.statusText}`,
			);
		}

		// Map Stripe's status to our normalized status.
		// Stripe has many statuses — we only care about a few.
		return {
			providerPaymentId: result.id, // "pi_3abc123..."
			status: this.mapStatus(result.status),
			rawResponse: result,
		};
	}

	/**
	 * Verify a Stripe webhook signature.
	 *
	 * Stripe sends: "sha256=<hex>" in the X-Webhook-Signature header.
	 * We recompute HMAC-SHA256(rawBody, webhookSecret) and compare.
	 */
	verifyWebhook(rawBody: Buffer, signature: string): boolean {
		if (!signature?.startsWith("sha256=")) {
			return false;
		}

		const expectedSig = signature.slice(7); // Remove "sha256=" prefix
		const computedSig = createHmac("sha256", this.webhookSecret)
			.update(rawBody)
			.digest("hex");

		try {
			// timingSafeEqual prevents timing attacks — always takes same
			// amount of time regardless of where the mismatch is.
			return timingSafeEqual(
				Buffer.from(expectedSig, "hex"),
				Buffer.from(computedSig, "hex"),
			);
		} catch {
			return false;
		}
	}

	/**
	 * Map Stripe-specific statuses to our normalized PaymentStatus.
	 *
	 * Stripe PaymentIntent statuses:
	 * - requires_payment_method, requires_confirmation, requires_action → "pending"
	 * - processing → "processing"
	 * - succeeded → "completed"
	 * - canceled → "failed"
	 */
	private mapStatus(stripeStatus: string): PaymentProviderResult["status"] {
		switch (stripeStatus) {
			case "succeeded":
				return "completed";
			case "processing":
				return "processing";
			case "canceled":
			case "requires_payment_method":
				return "failed";
			default:
				return "pending";
		}
	}
}

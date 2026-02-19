import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, PaymentProviderResult } from "./types.ts";

/**
 * Adyen payment provider implementation.
 *
 * Adyen API docs: https://docs.adyen.com/api-explorer/Checkout/71/post/payments
 *
 * Key differences from Stripe:
 * - Uses JSON bodies (not form-urlencoded)
 * - Auth via X-API-Key header (not Bearer token)
 * - Amount is nested: { value: 1000, currency: "USD" }
 * - Webhook verification uses Base64-encoded HMAC (not hex)
 * - Uses "merchantAccount" to identify which business account to use
 */
export class AdyenProvider implements PaymentProvider {
	readonly name = "adyen";
	readonly supportedCurrencies = ["SGD", "JPY", "KRW", "INR", "MYR"];

	constructor(
		/** Adyen API key from Customer Area. */
		private readonly apiKey: string,
		/** Adyen HMAC key for webhook verification. */
		private readonly hmacKey: string,
		/** Adyen merchant account identifier. */
		private readonly merchantAccount: string,
	) {}

	/**
	 * Create a payment via Adyen's Checkout API.
	 *
	 * Adyen's API is JSON-based (unlike Stripe's form-encoded).
	 * The amount format is { value, currency } instead of flat fields.
	 */
	async createPayment(data: {
		amount: number;
		currency: string;
		recipientEmail: string;
		description?: string;
	}): Promise<PaymentProviderResult> {
		const response = await fetch(
			"https://checkout-test.adyen.com/v71/payments",
			{
				method: "POST",
				headers: {
					// Adyen uses X-API-Key, not Authorization: Bearer.
					"X-API-Key": this.apiKey,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					// Adyen nests amount as an object — Stripe uses flat fields.
					amount: {
						value: data.amount,
						currency: data.currency.toUpperCase(),
					},
					merchantAccount: this.merchantAccount,
					reference: `pay_${Date.now()}`, // Your internal reference
					shopperEmail: data.recipientEmail,
					description: data.description,
					// "scheme" = card payments. Adyen requires you specify the method.
					paymentMethod: { type: "scheme" },
				}),
			},
		);

		const result = await response.json();

		if (!response.ok) {
			throw new Error(
				`Adyen API error: ${result.message ?? response.statusText}`,
			);
		}

		return {
			providerPaymentId: result.pspReference, // "8835..." (not "pi_" like Stripe)
			status: this.mapStatus(result.resultCode),
			rawResponse: result,
		};
	}

	/**
	 * Verify an Adyen webhook signature.
	 *
	 * Adyen differs from Stripe:
	 * - Uses Base64-encoded HMAC (Stripe uses hex)
	 * - HMAC key must be decoded from hex first
	 */
	verifyWebhook(rawBody: Buffer, signature: string): boolean {
		if (!signature) {
			return false;
		}

		try {
			// Adyen provides the HMAC key as hex — decode it to binary first.
			const keyBuffer = Buffer.from(this.hmacKey, "hex");
			const computedSig = createHmac("sha256", keyBuffer)
				.update(rawBody)
				.digest("base64"); // Base64, NOT hex like Stripe

			return timingSafeEqual(
				Buffer.from(signature, "base64"),
				Buffer.from(computedSig, "base64"),
			);
		} catch {
			return false;
		}
	}

	/**
	 * Map Adyen-specific result codes to our normalized status.
	 *
	 * Adyen resultCodes:
	 * - Authorised → "completed" (note: British spelling!)
	 * - Pending, Received → "processing"
	 * - Refused, Error, Cancelled → "failed"
	 */
	private mapStatus(adyenResultCode: string): PaymentProviderResult["status"] {
		switch (adyenResultCode) {
			case "Authorised": // British spelling — Adyen is Dutch!
				return "completed";
			case "Pending":
			case "Received":
				return "processing";
			case "Refused":
			case "Error":
			case "Cancelled":
				return "failed";
			default:
				return "pending";
		}
	}
}

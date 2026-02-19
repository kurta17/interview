/**
 * Standardized result from any payment provider.
 *
 * Every provider returns different data (Stripe returns "pi_xxx",
 * Adyen returns "pspReference", etc.) — this normalizes it into
 * one shape so services/payments.ts doesn't need to know which
 * provider was used.
 */
export interface PaymentProviderResult {
	/** The provider's unique ID for this payment (e.g. Stripe's "pi_abc123"). */
	providerPaymentId: string;

	/** Normalized status — mapped from provider-specific statuses. */
	status: "pending" | "processing" | "completed" | "failed";

	/** Raw API response — stored for debugging and support tickets. */
	rawResponse: unknown;
}

/**
 * Common interface every payment provider must implement.
 *
 * This is the "contract" — if you add a new provider (e.g. Checkout.com),
 * you just implement this interface and register it in the router.
 * No other code needs to change.
 */
export interface PaymentProvider {
	/** Unique identifier for this provider (e.g. "stripe", "adyen"). */
	readonly name: string;

	/** Which currencies this provider supports (e.g. ["USD", "EUR"]). */
	readonly supportedCurrencies: string[];

	/**
	 * Send a payment to the provider's API.
	 * Returns a normalized result regardless of which provider handles it.
	 */
	createPayment(data: {
		amount: number;
		currency: string;
		recipientEmail: string;
		description?: string;
	}): Promise<PaymentProviderResult>;

	/**
	 * Verify that an incoming webhook actually came from this provider.
	 * Each provider signs webhooks differently — this abstracts that away.
	 */
	verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

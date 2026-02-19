import type { PaymentProvider } from "./types.ts";

/**
 * Payment provider router — the "brain" of orchestration.
 *
 * This is what makes a payment orchestrator valuable:
 * instead of hardcoding "always use Stripe", the router picks
 * the best provider for each transaction based on currency,
 * region, success rates, cost, etc.
 *
 * In production, this would use:
 * - Historical success rate data per provider per currency
 * - Cost optimization (different providers charge different fees)
 * - Failover (if Stripe is down, route to Adyen)
 * - A/B testing (split traffic to compare providers)
 */
export class PaymentRouter {
	/** Map of provider name → provider instance for quick lookup. */
	private providers: Map<string, PaymentProvider>;

	constructor(providers: PaymentProvider[]) {
		this.providers = new Map(providers.map((p) => [p.name, p]));
	}

	/**
	 * Select the best provider for a given payment.
	 *
	 * Current logic: match by supported currency, fallback to first provider.
	 * In production, this would be much more sophisticated (ML models,
	 * success rate analysis, cost optimization, etc.).
	 */
	selectProvider(data: { currency: string; amount: number }): PaymentProvider {
		// Find a provider that supports this currency.
		for (const provider of this.providers.values()) {
			if (provider.supportedCurrencies.includes(data.currency)) {
				return provider;
			}
		}

		// Fallback: use the first registered provider.
		// In production, you'd throw an error or use a default.
		const fallback = this.providers.values().next().value;
		if (!fallback) {
			throw new Error(
				`No payment provider available for currency: ${data.currency}`,
			);
		}
		return fallback;
	}

	/**
	 * Get a specific provider by name.
	 *
	 * Used by the webhook handler — when Stripe sends a webhook,
	 * we need to look up the StripeProvider to verify the signature
	 * using Stripe's specific verification logic.
	 */
	getProviderByName(name: string): PaymentProvider | undefined {
		return this.providers.get(name);
	}

	/**
	 * List all registered providers.
	 * Useful for health checks and admin dashboards.
	 */
	listProviders(): PaymentProvider[] {
		return Array.from(this.providers.values());
	}
}

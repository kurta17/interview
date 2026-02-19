import { describe, expect, it } from "vitest";
import { PaymentRouter } from "#api/providers/router.ts";
import type { PaymentProvider } from "#api/providers/types.ts";

/**
 * Helper: create a minimal fake provider.
 */
function fakeProvider(
	name: string,
	currencies: string[],
): PaymentProvider {
	return {
		name,
		supportedCurrencies: currencies,
		createPayment: async () => ({
			providerPaymentId: `${name}_id`,
			status: "processing" as const,
			rawResponse: {},
		}),
		verifyWebhook: () => true,
	};
}

describe("PaymentRouter", () => {
	// ─────────────────────────────────────────────────────────
	// Currency-based selection — the core routing logic.
	// ─────────────────────────────────────────────────────────
	it("should select provider by supported currency", () => {
		const stripe = fakeProvider("stripe", ["USD", "EUR"]);
		const adyen = fakeProvider("adyen", ["SGD", "JPY"]);
		const router = new PaymentRouter([stripe, adyen]);

		expect(router.selectProvider({ currency: "USD", amount: 100 })).toBe(stripe);
		expect(router.selectProvider({ currency: "EUR", amount: 100 })).toBe(stripe);
		expect(router.selectProvider({ currency: "SGD", amount: 100 })).toBe(adyen);
		expect(router.selectProvider({ currency: "JPY", amount: 100 })).toBe(adyen);
	});

	// ─────────────────────────────────────────────────────────
	// Fallback — when no provider explicitly supports the
	// currency, the router falls back to the first provider.
	// ─────────────────────────────────────────────────────────
	it("should fallback to first provider for unsupported currency", () => {
		const stripe = fakeProvider("stripe", ["USD"]);
		const adyen = fakeProvider("adyen", ["SGD"]);
		const router = new PaymentRouter([stripe, adyen]);

		// BRL is not supported by either — should fallback to first.
		const selected = router.selectProvider({ currency: "BRL", amount: 100 });
		expect(selected).toBe(stripe);
	});

	// ─────────────────────────────────────────────────────────
	// No providers at all — should throw a clear error.
	// ─────────────────────────────────────────────────────────
	it("should throw when no providers are registered", () => {
		const router = new PaymentRouter([]);

		expect(() =>
			router.selectProvider({ currency: "USD", amount: 100 }),
		).toThrow("No payment provider available for currency: USD");
	});

	// ─────────────────────────────────────────────────────────
	// Provider lookup by name — used by webhook handlers.
	// ─────────────────────────────────────────────────────────
	it("should get provider by name", () => {
		const stripe = fakeProvider("stripe", ["USD"]);
		const adyen = fakeProvider("adyen", ["SGD"]);
		const router = new PaymentRouter([stripe, adyen]);

		expect(router.getProviderByName("stripe")).toBe(stripe);
		expect(router.getProviderByName("adyen")).toBe(adyen);
		expect(router.getProviderByName("nonexistent")).toBeUndefined();
	});

	// ─────────────────────────────────────────────────────────
	// List all providers — used for health checks / admin.
	// ─────────────────────────────────────────────────────────
	it("should list all registered providers", () => {
		const stripe = fakeProvider("stripe", ["USD"]);
		const adyen = fakeProvider("adyen", ["SGD"]);
		const router = new PaymentRouter([stripe, adyen]);

		const providers = router.listProviders();
		expect(providers).toHaveLength(2);
		expect(providers.map((p) => p.name)).toEqual(["stripe", "adyen"]);
	});
});

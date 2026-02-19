import { z } from "zod";

/**
 * Interview repo configuration schema with sensible defaults.
 */
export const schema = z.object({
	DATABASE_URL: z
		.string()
		.default("postgresql://postgres:postgres@localhost:5432/autopilot"),
	HOST: z.string().default("0.0.0.0"),
	PORT: z.coerce.number().default(3001),
	SECRET_KEY: z.string().default("interview-secret-key-change-in-production"),
	DASHBOARD_URL: z.string().default("http://localhost:3000"),
	API_URL: z.string().default("http://localhost:3001"),
	WEBHOOK_SECRET: z.string().default("whsec_test_secret_for_development"),

	// Provider API keys — each provider needs its own credentials.
	// Defaults are test/dummy values for local development only.
	STRIPE_SECRET_KEY: z.string().default("sk_test_dummy_key_for_development"),
	STRIPE_WEBHOOK_SECRET: z.string().default("whsec_stripe_test_secret"),
	ADYEN_API_KEY: z.string().default("adyen_test_dummy_key_for_development"),
	ADYEN_HMAC_KEY: z.string().default("adyen_test_hmac_key"),
	ADYEN_MERCHANT_ACCOUNT: z.string().default("TestMerchantAccount"),
});

/**
 * Creates a configuration object by parsing environment variables.
 *
 * @returns Parsed and validated configuration object.
 */
export function defineConfig() {
	return schema.parse(process.env);
}

export type Config = ReturnType<typeof defineConfig>;

import { relations } from "#api/databases/relations.ts";
import * as schema from "#api/databases/schema.ts";
import { AdyenProvider } from "#api/providers/adyen.ts";
import { PaymentRouter } from "#api/providers/router.ts";
import { StripeProvider } from "#api/providers/stripe.ts";
import { defineAuth } from "./auth.ts";
import { defineConfig } from "./config.ts";
import { defineDatabase } from "./database.ts";
import { defineLogger } from "./logger.ts";

/**
 * The IoC container type.
 */
export type Container = Awaited<ReturnType<typeof defineContainer>>;

/**
 * Defines the IoC container with all dependencies.
 */
export async function defineContainer() {
	const config = defineConfig();
	const logger = await defineLogger({
		level: "info",
		redact: [],
	});
	const db = await defineDatabase({
		logger,
		poolConfig: {
			connectionString: config.DATABASE_URL,
		},
		relations,
		schema,
	});
	const auth = defineAuth({
		config,
		db,
		logger,
	});

	// Initialize payment providers with credentials from config.
	// Each provider is created once and reused for every request.
	const paymentRouter = new PaymentRouter([
		new StripeProvider(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET),
		new AdyenProvider(
			config.ADYEN_API_KEY,
			config.ADYEN_HMAC_KEY,
			config.ADYEN_MERCHANT_ACCOUNT,
		),
	]);

	return {
		auth,
		config,
		db,
		logger,
		paymentRouter,
	};
}

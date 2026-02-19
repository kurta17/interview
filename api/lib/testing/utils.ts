import type { Request } from "ultimate-express";
import { test } from "vitest";
import { mock } from "vitest-mock-extended";
import { relations } from "#api/databases/relations.ts";
import * as schema from "#api/databases/schema.ts";
import { payments, users } from "#api/databases/schema.ts";
import type { AppContext } from "#api/primitives/app-context.ts";
import { defineAuth } from "#api/primitives/auth.ts";
import { defineConfig } from "#api/primitives/config.ts";
import { defineTestDatabase } from "#api/primitives/database.ts";
import type { Logger } from "#api/primitives/logger.ts";
import { PaymentRouter } from "#api/providers/router.ts";
import type { PaymentProvider } from "#api/providers/types.ts";

/**
 * The mock container type.
 */
export type MockContainer = Awaited<
	ReturnType<typeof defineMockContainer>
>["container"];

/**
 * Defines a mock container with isolated test database for testing.
 *
 * @returns Container with test database and cleanup function.
 *
 * @example
 * ```typescript
 * const { container, cleanUp } = await defineMockContainer();
 * await container.db.insert(users).values({...});
 * await cleanUp();
 * ```
 */
export async function defineMockContainer() {
	const config = defineConfig();
	const logger = mock<Logger>();
	const { db, cleanUp: dbCleanUp } = await defineTestDatabase({
		connectionString: config.DATABASE_URL,
		logger,
		name: "autopilot-interview",
		relations,
		schema,
	});
	const auth = defineAuth({
		config,
		db,
		logger,
	});

	return {
		container: {
			auth,
			config,
			db,
			logger,
			paymentRouter: new PaymentRouter([]),
		},
		cleanUp: async () => {
			await dbCleanUp();
		},
	};
}

/**
 * Server-side test that provides an isolated test database with automatic
 * cleanup. Each test gets its own PostgreSQL database for complete isolation.
 *
 * @example
 * ```typescript
 * import { serverTest } from "#api/lib/testing/utils.ts";
 * import { users, payments } from "#api/databases/schema.ts";
 *
 * serverTest("creates payment", async ({ container }) => {
 *   // Create a test user
 *   const [user] = await container.db
 *     .insert(users)
 *     .values({ email: "test@example.com", name: "Test" })
 *     .returning();
 *
 *   // Create a payment
 *   const [payment] = await container.db
 *     .insert(payments)
 *     .values({
 *       amount: 1000,
 *       recipientEmail: "recipient@example.com",
 *       createdBy: user.id,
 *     })
 *     .returning();
 *
 *   expect(payment.amount).toBe(1000);
 * });
 * ```
 */
export const serverTest = test.extend<{
	container: MockContainer;
}>({
	async container({}, use) {
		const { container, cleanUp } = await defineMockContainer();
		await use(container);
		await cleanUp();
	},
});

/**
 * Creates a properly typed AppContext for testing.
 * Uses mock<Request>() to avoid type assertion issues.
 *
 * @example
 * ```typescript
 * const ctx = defineTestAppContext(container, {
 *   apiKey: { id: "key-id", name: "Test Key", userId: user.id },
 * });
 * ```
 */
export function defineTestAppContext(
	container: MockContainer,
	overrides: {
		apiKey?: AppContext["apiKey"];
		session?: AppContext["session"];
		user?: AppContext["user"];
	} = {},
): AppContext {
	return {
		apiKey: overrides.apiKey ?? null,
		container,
		request: mock<Request>(),
		session: overrides.session ?? null,
		user: overrides.user ?? null,
	};
}

/**
 * Creates a test user in the database.
 */
export async function createTestUser(
	db: MockContainer["db"],
	overrides: Partial<typeof users.$inferInsert> = {},
) {
	const [user] = await db
		.insert(users)
		.values({
			email: "test@example.com",
			name: "Test User",
			...overrides,
		})
		.returning();
	return user;
}

/**
 * Creates a test payment directly in the database.
 */
export async function createTestPayment(
	db: MockContainer["db"],
	userId: string,
	overrides: Partial<typeof payments.$inferInsert> = {},
) {
	const [payment] = await db
		.insert(payments)
		.values({
			amount: 1000,
			currency: "USD",
			recipientEmail: "recipient@example.com",
			createdBy: userId,
			...overrides,
		})
		.returning();
	return payment;
}

/**
 * Creates a fake payment provider for testing.
 *
 * Instead of calling real Stripe/Adyen in tests, you create fake
 * providers that implement the same interface and return controlled
 * responses.
 */
export function fakeProvider(
	overrides: Partial<PaymentProvider> & {
		name: string;
		supportedCurrencies: string[];
	},
): PaymentProvider {
	return {
		createPayment: async () => ({
			providerPaymentId: "fake_provider_id_123",
			status: "processing" as const,
			rawResponse: { fake: true },
		}),
		verifyWebhook: () => true,
		...overrides,
	};
}

/**
 * Creates an AppContext with a custom PaymentRouter.
 *
 * This lets each test inject different provider behaviors
 * (success, failure, specific currencies) without changing
 * the real container.
 */
export function ctxWithRouter(
	container: MockContainer,
	providers: PaymentProvider[],
): AppContext {
	const ctx = defineTestAppContext(container);
	ctx.container = {
		...ctx.container,
		paymentRouter: new PaymentRouter(providers),
	};
	return ctx;
}

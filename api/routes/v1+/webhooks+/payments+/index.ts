import { z } from "zod";
import { verifyWebhookSignature } from "#api/lib/webhooks/verify.ts";
import {
	defineOpenAPI,
	defineOpenAPIEndpoint,
} from "#api/primitives/openapi.ts";
import { getPaymentById, updatePaymentStatus } from "#api/services/payments.ts";

const WebhookEventSchema = z.object({
	id: z.string(),
	type: z.literal("payment.status_changed"),
	data: z.object({
		paymentId: z.string(),
		newStatus: z.enum(["processing", "completed", "failed"]),
		previousStatus: z.enum(["pending", "processing"]),
	}),
});

/**
 * Webhook handler for payment status updates from external provider.
 */
export default defineOpenAPI({
	POST: defineOpenAPIEndpoint({
		summary: "Handle payment status webhook",
		requestBody: WebhookEventSchema,
		responses: {
			200: {
				description: "Webhook processed",
				schema: z.object({ received: z.boolean() }),
			},
			401: {
				description: "Invalid signature",
				schema: z.object({ error: z.string() }),
			},
		},
		async handler({ ctx, body, request, response }) {
			// Verify webhook signature.
			// rawBody is attached by the raw body middleware in server.ts but isn't
			// part of the Express Request type, so we cast to access it.
			const isValid = verifyWebhookSignature(
				(request as unknown as { rawBody: Buffer }).rawBody,
				request.headers["x-webhook-signature"] as string | undefined,
				ctx.container.config.WEBHOOK_SECRET,
			);
			if (!isValid) {
				return response.unauthorized({ error: "Invalid signature" });
			}

			// Idempotency — skip if already processed
			const existing = await getPaymentById(ctx, body.data.paymentId);
			if (!existing) {
				return response.ok({ received: true });
			}
			if (existing.lastWebhookId === body.id) {
				return response.ok({ received: true });
			}

			// Update status
			await updatePaymentStatus(
				ctx,
				body.data.paymentId,
				body.data.newStatus,
				body.id,
			);

			return response.ok({ received: true });
		},
	}),
});

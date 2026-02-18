import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createPayment,
	getPaymentById,
	listPayments,
} from "#api/services/payments.ts";
import { protectedProcedure, router } from "./init.ts";

/**
 * Payments router for dashboard internal use.
 */
export const paymentsRouter = router({
	/**
	 * Get a payment by ID.
	 * Only returns the payment if the authenticated user owns it.
	 */
	getById: protectedProcedure
		.input(z.object({ id: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const payment = await getPaymentById(ctx, input.id);

			if (!payment) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Payment not found",
				});
			}

			// Ensure user owns this payment.
			if (payment.createdBy !== ctx.user.id) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Payment not found",
				});
			}

			return payment;
		}),

	/**
	 * Create a new payment. Amount is in cents, assigned to the authenticated user.
	 */
	create: protectedProcedure
		.input(
			z.object({
				amount: z.number().int().positive(),
				recipientEmail: z.string().email(),
				description: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return createPayment(ctx, { ...input, createdBy: ctx.user.id });
		}),

	/**
	 * List all payments for the authenticated user, newest first.
	 */
	list: protectedProcedure.query(async ({ ctx }) => {
		return listPayments(ctx, ctx.user.id);
	}),
});

import { useState } from "react";
import { trpc } from "#dashboard/app/lib/trpc.tsx";

/**
 * Payments page — create payments and view payment history.
 */
export default function PaymentsPage() {
	const utils = trpc.useUtils();

	const { data: payments, isLoading } = trpc.payments.list.useQuery();

	const createMutation = trpc.payments.create.useMutation({
		onSuccess: () => utils.payments.list.invalidate(),
	});

	const [amount, setAmount] = useState("");
	const [currency, setCurrency] = useState<"USD" | "SGD">("USD");
	const [recipientEmail, setRecipientEmail] = useState("");
	const [description, setDescription] = useState("");

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		createMutation.mutate({
			amount: Math.round(parseFloat(amount) * 100),
			currency,
			recipientEmail,
			description: description || undefined,
		});
		setAmount("");
		setCurrency("USD");
		setRecipientEmail("");
		setDescription("");
	};

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-2xl font-bold text-gray-900">Payments</h1>
				<p className="mt-1 text-sm text-gray-500">
					Create and manage your payments
				</p>
			</div>

			{/* Create payment form */}
			<div className="rounded-lg border bg-white p-6">
				<h2 className="text-lg font-medium">Create Payment</h2>

				<form className="mt-4 space-y-4" onSubmit={handleSubmit}>
					{createMutation.error && (
						<div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
							{createMutation.error.message}
						</div>
					)}

					<div>
						<div className="flex gap-4">
							<div className="flex-1">
								<label
									htmlFor="amount"
									className="block text-sm font-medium text-gray-700"
								>
									Amount
								</label>
								<input
									id="amount"
									type="number"
									min="0.01"
									step="0.01"
									required
									placeholder="0.00"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
								/>
							</div>
							<div className="w-28">
								<label
									htmlFor="currency"
									className="block text-sm font-medium text-gray-700"
								>
									Currency
								</label>
								<select
									id="currency"
									value={currency}
									onChange={(e) =>
										setCurrency(e.target.value as "USD" | "SGD")
									}
									className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
								>
									<option value="USD">USD</option>
									<option value="SGD">SGD</option>
								</select>
							</div>
						</div>
					</div>

					<div>
						<label
							htmlFor="recipientEmail"
							className="block text-sm font-medium text-gray-700"
						>
							Recipient Email
						</label>
						<input
							id="recipientEmail"
							type="email"
							required
							placeholder="recipient@example.com"
							value={recipientEmail}
							onChange={(e) => setRecipientEmail(e.target.value)}
							className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
						/>
					</div>

					<div>
						<label
							htmlFor="description"
							className="block text-sm font-medium text-gray-700"
						>
							Description (optional)
						</label>
						<input
							id="description"
							type="text"
							placeholder="What is this payment for?"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
						/>
					</div>

					<button
						type="submit"
						disabled={createMutation.isPending}
						className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50"
					>
						{createMutation.isPending ? "Sending..." : "Send Payment"}
					</button>
				</form>
			</div>

			{/* Payment history table */}
			<div className="rounded-lg border bg-white p-6">
				<h2 className="text-lg font-medium">Payment History</h2>

				{isLoading ? (
					<p className="mt-4 text-sm text-gray-500">Loading payments...</p>
				) : !payments?.length ? (
					<p className="mt-4 text-sm text-gray-500">No payments yet.</p>
				) : (
					<div className="mt-4 overflow-x-auto">
						<table className="min-w-full divide-y divide-gray-200">
							<thead>
								<tr>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
										Date
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
										Recipient
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
										Description
									</th>
									<th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
										Amount
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
										Status
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-200">
								{payments.map((payment) => (
									<tr key={payment.id}>
										<td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
											{new Date(payment.createdAt).toLocaleDateString()}
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
											{payment.recipientEmail}
										</td>
										<td className="px-4 py-3 text-sm text-gray-500">
											{payment.description ?? "—"}
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900">
											{(payment.amount / 100).toFixed(2)}{" "}
											{payment.currency}
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-sm">
											<span
												className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
													payment.status === "completed"
														? "bg-green-100 text-green-800"
														: payment.status === "failed"
															? "bg-red-100 text-red-800"
															: "bg-yellow-100 text-yellow-800"
												}`}
											>
												{payment.status}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}

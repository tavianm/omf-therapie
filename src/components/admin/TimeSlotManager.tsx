import { useEffect, useState } from "react";
import { toast, Toaster } from "react-hot-toast";
import { Modal } from "./Modal";
import type { ManualTimeSlot, Period, CreateManualSlotData } from "../../types/manual-slots";

const PERIOD_LABELS: Record<Period, string> = {
	morning: "Matin",
	afternoon: "Après-midi",
	all_day: "Journée complète",
};

function formatDate(isoDate: string): string {
	return new Intl.DateTimeFormat("fr-FR", {
		day: "2-digit",
		month: "long",
		year: "numeric",
		timeZone: "Europe/Paris",
	}).format(new Date(isoDate));
}

function getPanelId(slotId: string): string {
	return `slot-panel-${slotId}`;
}

export default function TimeSlotManager() {
	const [slots, setSlots] = useState<ManualTimeSlot[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingSlot, setEditingSlot] = useState<ManualTimeSlot | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [deleteConfirmSlot, setDeleteConfirmSlot] = useState<ManualTimeSlot | null>(null);
	const [formData, setFormData] = useState({
		slot_date: "",
		period: "morning" as Period,
	});

	// Calculate date range for fetching slots (next 3 months)
	const today = new Date();
	const threeMonthsFromNow = new Date();
	threeMonthsFromNow.setMonth(today.getMonth() + 3);

	const fromDate = today.toISOString().split("T")[0];
	const toDate = threeMonthsFromNow.toISOString().split("T")[0];

	useEffect(() => {
		const controller = new AbortController();

		async function fetchSlots() {
			setLoading(true);
			setError(null);
			try {
				const response = await fetch(
					`/api/admin/time-slots?from=${fromDate}&to=${toDate}`,
					{
						method: "GET",
						credentials: "same-origin",
						signal: controller.signal,
					},
				);

				if (!response.ok) {
					const body = (await response.json()) as { error?: string };
					throw new Error(body.error ?? "Erreur lors du chargement des plages horaires");
				}

				const body = (await response.json()) as { slots: ManualTimeSlot[] };
				setSlots(body.slots ?? []);
			} catch (err) {
				if (controller.signal.aborted) return;
				setError(err instanceof Error ? err.message : "Erreur inconnue");
			} finally {
				if (!controller.signal.aborted) {
					setLoading(false);
				}
			}
		}

		fetchSlots();

		return () => controller.abort();
	}, [fromDate, toDate]);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setIsSubmitting(true);

		try {
			if (editingSlot) {
				// Update existing slot
				const response = await fetch(`/api/admin/time-slots/${editingSlot.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					credentials: "same-origin",
					body: JSON.stringify({ period: formData.period }),
				});

				if (!response.ok) {
					const body = (await response.json()) as { error?: string };
					throw new Error(body.error ?? "Erreur lors de la mise à jour de la plage horaire");
				}

				const updatedSlot = (await response.json()) as ManualTimeSlot;
				setSlots((current) =>
					current.map((slot) => (slot.id === updatedSlot.id ? updatedSlot : slot)),
				);
				toast.success("Plage horaire mise à jour avec succès", { duration: 4000 });
			} else {
				// Create new slot
				const slotData: CreateManualSlotData = {
					slot_date: formData.slot_date,
					period: formData.period,
				};

				const response = await fetch("/api/admin/time-slots", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "same-origin",
					body: JSON.stringify(slotData),
				});

				if (!response.ok) {
					const body = (await response.json()) as { error?: string };
					throw new Error(body.error ?? "Erreur lors de la création de la plage horaire");
				}

				const newSlot = (await response.json()) as ManualTimeSlot;
				setSlots((current) => [...current, newSlot]);
				toast.success("Plage horaire créée avec succès", { duration: 4000 });
			}

			setIsModalOpen(false);
			resetForm();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Erreur inconnue", { duration: 4000 });
		} finally {
			setIsSubmitting(false);
		}
	}

	async function handleDelete(slot: ManualTimeSlot) {
		try {
			const response = await fetch(`/api/admin/time-slots/${slot.id}`, {
				method: "DELETE",
				credentials: "same-origin",
			});

			if (!response.ok) {
				const body = (await response.json()) as { error?: string };
				throw new Error(body.error ?? "Erreur lors de la suppression de la plage horaire");
			}

			setSlots((current) => current.filter((s) => s.id !== slot.id));
			toast.success("Plage horaire supprimée avec succès", { duration: 4000 });
			setDeleteConfirmSlot(null);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Erreur inconnue", { duration: 4000 });
		}
	}

	function openCreateModal() {
		setEditingSlot(null);
		setFormData({
			slot_date: new Date().toISOString().split("T")[0],
			period: "morning",
		});
		setIsModalOpen(true);
	}

	function openEditModal(slot: ManualTimeSlot) {
		setEditingSlot(slot);
		setFormData({
			slot_date: slot.slot_date,
			period: slot.period,
		});
		setIsModalOpen(true);
	}

	function resetForm() {
		setFormData({
			slot_date: "",
			period: "morning",
		});
		setEditingSlot(null);
	}

	return (
		<section
			className="space-y-4"
			aria-labelledby="slots-heading"
		>
			<Toaster position="top-right" />
			<div className="flex items-center justify-between gap-3">
				<h2
					id="slots-heading"
					className="font-serif text-xl text-sage-800"
				>
					Gestion des plages horaires
				</h2>
				<button
					type="button"
					onClick={openCreateModal}
					className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl bg-mint-600 text-white hover:bg-mint-700 focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1 transition-colors min-h-[40px]"
				>
					Ajouter une plage
				</button>
			</div>

			{error && (
				<p
					className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-sans"
					role="alert"
				>
					{error}
				</p>
			)}

			{loading && (
				<p
					className="text-sm text-sage-500 font-sans"
					role="status"
					aria-live="polite"
				>
					Chargement des plages horaires...
				</p>
			)}

			{!loading && !error && slots.length === 0 && (
				<p className="rounded-2xl border border-sage-200 bg-white px-5 py-6 text-center text-sage-500 font-sans">
					Aucune plage horaire configurée pour les 3 prochains mois.
				</p>
			)}

			{!loading && !error && slots.length > 0 && (
				<ul className="space-y-3">
					{slots.map((slot) => {
						const panelId = getPanelId(slot.id);

						return (
							<li
								key={slot.id}
								className="rounded-2xl border border-sage-200 bg-white"
							>
								<div
									id={panelId}
									className="px-4 py-4"
								>
									<div className="grid gap-3 sm:grid-cols-3 items-center">
										<div>
											<p className="text-xs text-sage-500 font-sans">Date</p>
											<p className="text-sm text-sage-900 font-medium font-sans">
												{formatDate(slot.slot_date)}
											</p>
										</div>
										<div>
											<p className="text-xs text-sage-500 font-sans">Période</p>
											<p className="text-sm text-sage-900 font-sans">
												{PERIOD_LABELS[slot.period]}
											</p>
										</div>
										<div className="flex items-center gap-2 justify-end">
											<button
												type="button"
												onClick={() => openEditModal(slot)}
												className="inline-flex items-center px-3 py-1.5 text-sm font-medium font-sans rounded-lg border border-sage-300 text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-sage-300 focus:ring-offset-1 transition-colors"
												aria-label={`Modifier la plage du ${formatDate(slot.slot_date)}`}
											>
												Modifier
											</button>
											<button
												type="button"
												onClick={() => setDeleteConfirmSlot(slot)}
												className="inline-flex items-center px-3 py-1.5 text-sm font-medium font-sans rounded-lg border border-red-300 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition-colors"
												aria-label={`Supprimer la plage du ${formatDate(slot.slot_date)}`}
											>
												Supprimer
											</button>
										</div>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			)}

			{/* Create/Edit Modal */}
			{isModalOpen && (
				<Modal
					title={editingSlot ? "Modifier la plage horaire" : "Ajouter une plage horaire"}
					onClose={() => setIsModalOpen(false)}
				>
					<form onSubmit={handleSubmit} className="space-y-4">
						<div>
							<label
								htmlFor="slot-date"
								className="block text-sm font-medium text-sage-700 font-sans mb-1.5"
							>
								Date
							</label>
							<input
								id="slot-date"
								type="date"
								value={formData.slot_date}
								onChange={(e) => setFormData({ ...formData, slot_date: e.target.value })}
								required
								min={fromDate}
								max={toDate}
								className="w-full px-4 py-2.5 rounded-xl border border-sage-200 bg-sage-50 text-sage-900 placeholder-sage-400 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent transition-colors"
							/>
						</div>

						<div>
							<label
								htmlFor="slot-period"
								className="block text-sm font-medium text-sage-700 font-sans mb-1.5"
							>
								Période
							</label>
							<select
								id="slot-period"
								value={formData.period}
								onChange={(e) => setFormData({ ...formData, period: e.target.value as Period })}
								className="w-full px-4 py-2.5 rounded-xl border border-sage-200 bg-sage-50 text-sage-900 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent transition-colors"
							>
								<option value="morning">Matin</option>
								<option value="afternoon">Après-midi</option>
								<option value="all_day">Journée complète</option>
							</select>
						</div>

						<div className="flex gap-2 justify-end pt-2">
							<button
								type="button"
								onClick={() => setIsModalOpen(false)}
								disabled={isSubmitting}
								className="px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 transition-colors disabled:opacity-60 min-h-[40px]"
							>
								Annuler
							</button>
							<button
								type="submit"
								disabled={isSubmitting}
								className="px-4 py-2 text-sm font-medium font-sans rounded-xl bg-mint-600 text-white hover:bg-mint-700 transition-colors disabled:opacity-60 min-h-[40px]"
							>
								{isSubmitting
									? "En cours..."
									: editingSlot
										? "Mettre à jour"
										: "Créer"}
							</button>
						</div>
					</form>
				</Modal>
			)}

			{/* Delete Confirmation Modal */}
			{deleteConfirmSlot && (
				<Modal
					title="Confirmer la suppression"
					onClose={() => setDeleteConfirmSlot(null)}
				>
					<div className="space-y-4">
						<p className="text-sm text-sage-700 font-sans">
							Êtes-vous sûr de vouloir supprimer la plage horaire du{" "}
							<strong>{formatDate(deleteConfirmSlot.slot_date)}</strong> (
							{PERIOD_LABELS[deleteConfirmSlot.period]}) ?
						</p>
						<div className="flex gap-2 justify-end">
							<button
								type="button"
								onClick={() => setDeleteConfirmSlot(null)}
								className="px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 transition-colors min-h-[40px]"
							>
								Annuler
							</button>
							<button
								type="button"
								onClick={() => handleDelete(deleteConfirmSlot)}
								className="px-4 py-2 text-sm font-medium font-sans rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors min-h-[40px]"
							>
								Supprimer
							</button>
						</div>
					</div>
				</Modal>
			)}
		</section>
	);
}

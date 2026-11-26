"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Plus,
  Star,
  Trash2,
  Upload,
  Stethoscope,
  FlaskConical,
  MessageSquare,
  Clock,
  Phone,
  Pencil,
} from "lucide-react";
import type { MediaAssetPurpose } from "@/lib/storefront/image-optimizer";
import { PortalActionButton, PortalConfirmModal } from "@/components/portal/PortalUI";

interface SharedTabProps {
  sfId: string;
  saving: boolean;
  uploadingImage: boolean;
  resolveMediaUrl: (raw?: string | null) => string;
  postWebsiteAction: (action: string, extraBody?: Record<string, any>) => Promise<any>;
  uploadCompressedWebP: (
    file: File,
    purpose: MediaAssetPurpose,
    entityId?: string,
    onUrlReady?: (url: string) => void,
    entityTypeOverride?: string
  ) => Promise<void>;
  notify: (msg: string) => void;
}

/* ========================================================================= */
/* 1. CUSTOMER REVIEWS MODERATION TAB (1-CLICK PUBLISH + PUBLISH ALL!)       */
/* ========================================================================= */
export function PortalReviewsTab({
  reviews,
  saving,
  postWebsiteAction,
  notify,
}: {
  reviews: any[];
  saving: boolean;
  postWebsiteAction: (action: string, extraBody?: Record<string, any>) => Promise<any>;
  notify: (msg: string) => void;
}) {
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "published" | "hidden">("all");
  const [replyDraftById, setReplyDraftById] = useState<Record<string, string>>({});
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    details?: string;
    confirmLabel: string;
    tone: "danger" | "warning" | "primary";
    onConfirm: () => Promise<void>;
  } | null>(null);

  const pendingCount = reviews.filter((r) => r.status === "pending").length;
  const publishedCount = reviews.filter((r) => r.status === "published").length;

  const visibleReviews = reviews.filter((r) =>
    filterStatus === "all" ? true : r.status === filterStatus
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#D8E0EA] bg-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[#0F766E]" />
            <h2 className="text-base font-bold text-[#0F172A]">
              Verified Order Reviews &amp; Customer Feedback
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            Customers submit feedback directly from their Order Tracking page. Publish reviews individually or all at once to showcase them on your website.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pendingCount > 0 && (
            <PortalActionButton
              variant="primary"
              size="md"
              disabled={saving}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              onClick={() =>
                setConfirmState({
                  title: `Publish all ${pendingCount} pending review(s)?`,
                  description:
                    "All pending customer reviews will immediately become visible on your live pharmacy website.",
                  confirmLabel: `Publish All (${pendingCount})`,
                  tone: "primary",
                  onConfirm: async () => {
                    const res = await postWebsiteAction("publish_all_reviews");
                    notify(
                      `Published ${res?.published_count ?? pendingCount} pending customer review(s) on your website!`
                    );
                    setConfirmState(null);
                  },
                })
              }
            >
              Publish All Pending ({pendingCount})
            </PortalActionButton>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: "all", label: `All (${reviews.length})` },
            { id: "pending", label: `Pending Approval (${pendingCount})` },
            { id: "published", label: `Published Live (${publishedCount})` },
            {
              id: "hidden",
              label: `Hidden (${reviews.filter((r) => r.status === "hidden").length})`,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterStatus(tab.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition ${
              filterStatus === tab.id
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {visibleReviews.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-2">
          <Star className="h-8 w-8 text-amber-400 mx-auto" />
          <p className="text-sm font-bold text-slate-900">No customer reviews in this view yet</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            When customers track their online orders on your website, they can submit a verified 5-star review which appears right here for 1-click publishing.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visibleReviews.map((rev) => {
            const draftReply =
              replyDraftById[rev.id] !== undefined ? replyDraftById[rev.id] : rev.owner_reply || "";
            return (
              <div
                key={rev.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3.5 shadow-xs flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">{rev.customer_name}</span>
                        <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10.5px] font-bold text-slate-700">
                          {rev.order_number}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-amber-500 text-sm">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <span key={s}>{s <= Number(rev.rating || 5) ? "★" : "☆"}</span>
                        ))}
                        <span className="ml-1.5 text-[11px] text-slate-500 font-medium">
                          {rev.created_at ? new Date(rev.created_at).toLocaleDateString() : ""}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                        rev.status === "published"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : rev.status === "hidden"
                          ? "bg-slate-100 text-slate-600 border-slate-200"
                          : "bg-amber-50 text-amber-800 border-amber-200"
                      }`}
                    >
                      {rev.status === "published"
                        ? "Live on Website"
                        : rev.status === "hidden"
                        ? "Hidden"
                        : "Pending"}
                    </span>
                  </div>

                  <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-3 border border-slate-100">
                    &ldquo;{rev.comment}&rdquo;
                  </p>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={draftReply}
                      onChange={(e) =>
                        setReplyDraftById((p) => ({ ...p, [rev.id]: e.target.value }))
                      }
                      placeholder="Optional pharmacy reply (e.g. Thank you for trusting us!)…"
                      className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        await postWebsiteAction("update_review", {
                          review_id: rev.id,
                          status: rev.status === "pending" ? "published" : rev.status,
                          owner_reply: draftReply,
                        });
                        notify("Saved reply & review status");
                      }}
                      className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shrink-0"
                    >
                      Save Reply
                    </button>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {rev.status !== "published" ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={async () => {
                          await postWebsiteAction("update_review", {
                            review_id: rev.id,
                            status: "published",
                            owner_reply: draftReply || undefined,
                          });
                          notify("Review published live on your website!");
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#009A4D] hover:bg-emerald-700 text-white text-xs font-bold"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Publish on Website</span>
                      </button>
                    ) : (
                      <PortalActionButton
                        variant="secondary"
                        size="sm"
                        disabled={saving}
                        icon={<EyeOff className="h-3.5 w-3.5" />}
                        onClick={() =>
                          setConfirmState({
                            title: "Hide this review from your website?",
                            description:
                              "This review will no longer be visible to public website visitors. You can republish it later.",
                            details: `${rev.customer_name} (${rev.order_number})`,
                            confirmLabel: "Yes, Hide Review",
                            tone: "warning",
                            onConfirm: async () => {
                              await postWebsiteAction("update_review", {
                                review_id: rev.id,
                                status: "hidden",
                              });
                              notify("Review hidden from public website");
                              setConfirmState(null);
                            },
                          })
                        }
                      >
                        Hide
                      </PortalActionButton>
                    )}
                  </div>

                  <PortalActionButton
                    variant="danger"
                    size="sm"
                    disabled={saving}
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() =>
                      setConfirmState({
                        title: "Delete customer review permanently?",
                        description:
                          "This permanently removes this customer review and cannot be undone.",
                        details: `${rev.customer_name} • ${rev.order_number}`,
                        confirmLabel: "Delete Review",
                        tone: "danger",
                        onConfirm: async () => {
                          await postWebsiteAction("delete_review", { review_id: rev.id });
                          notify("Deleted review");
                          setConfirmState(null);
                        },
                      })
                    }
                  >
                    Delete
                  </PortalActionButton>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PortalConfirmModal
        open={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        onConfirm={async () => {
          if (confirmState) await confirmState.onConfirm();
        }}
        title={confirmState?.title || ""}
        description={confirmState?.description}
        details={confirmState?.details}
        confirmLabel={confirmState?.confirmLabel || "Confirm"}
        tone={confirmState?.tone || "primary"}
        loading={saving}
      />
    </div>
  );
}

/* ========================================================================= */
/* 2. OPTIONAL IN-HOUSE DOCTORS & CLINIC TAB                                 */
/* ========================================================================= */
const EMPTY_DOCTOR = {
  id: "",
  name: "",
  qualification: "",
  specialization: "",
  timings: "05:00 PM – 09:00 PM",
  days_available: "Mon – Sat",
  consultation_fee_pkr: 1000,
  experience_years: "",
  room_or_clinic_note: "",
  bio: "",
  booking_phone: "",
  photo_url: "",
  is_active: true,
};

export function PortalDoctorsTab({
  doctors,
  sfId,
  saving,
  uploadingImage,
  resolveMediaUrl,
  postWebsiteAction,
  uploadCompressedWebP,
  notify,
}: SharedTabProps & { doctors: any[] }) {
  const [form, setForm] = useState({ ...EMPTY_DOCTOR });
  const [doctorToDelete, setDoctorToDelete] = useState<any | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Add / Edit Doctor Form */}
      <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs h-fit">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-900">
              {form.id ? "Edit Doctor Profile" : "Add In-House Doctor"}
            </h2>
          </div>
          {form.id && (
            <button
              type="button"
              onClick={() => setForm({ ...EMPTY_DOCTOR })}
              className="text-xs font-bold text-slate-500 hover:text-slate-900"
            >
              Cancel Edit
            </button>
          )}
        </div>

        <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-3 text-[11.5px] text-emerald-900">
          <strong>Optional Section:</strong> Your website only displays the Doctors section &amp; tab when you have at least 1 active doctor added here.
        </div>

        {/* Doctor Photo (Strict Auto WebP <= 35KB) */}
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-3 min-w-0">
            {form.photo_url ? (
              <img
                src={resolveMediaUrl(form.photo_url)}
                alt="Doctor"
                className="w-12 h-12 rounded-xl object-cover border border-slate-200 bg-white shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center shrink-0">
                DR
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">Doctor Photo (Optional)</p>
              <p className="text-[11px] text-slate-500">Auto-compressed to &lt;35 KB WebP</p>
            </div>
          </div>
          <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 text-xs font-bold shrink-0">
            <Upload className="h-3.5 w-3.5" />
            <span>{uploadingImage ? "Compressing…" : "Upload"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  void uploadCompressedWebP(
                    f,
                    "doctor",
                    form.id || sfId,
                    (url) => setForm((p) => ({ ...p, photo_url: url })),
                    "doctor"
                  );
                }
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">Doctor Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Dr. Muhammad Usman"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Qualification</label>
            <input
              type="text"
              value={form.qualification}
              onChange={(e) => setForm((p) => ({ ...p, qualification: e.target.value }))}
              placeholder="e.g. MBBS, FCPS"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Specialization</label>
            <input
              type="text"
              value={form.specialization}
              onChange={(e) => setForm((p) => ({ ...p, specialization: e.target.value }))}
              placeholder="e.g. General Physician / Child Specialist"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Timings</label>
            <input
              type="text"
              value={form.timings}
              onChange={(e) => setForm((p) => ({ ...p, timings: e.target.value }))}
              placeholder="e.g. 05:00 PM - 09:00 PM"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Days Available</label>
            <input
              type="text"
              value={form.days_available}
              onChange={(e) => setForm((p) => ({ ...p, days_available: e.target.value }))}
              placeholder="e.g. Mon - Sat"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Consultation Fee (PKR)
            </label>
            <input
              type="number"
              min={0}
              value={form.consultation_fee_pkr}
              onChange={(e) =>
                setForm((p) => ({ ...p, consultation_fee_pkr: Number(e.target.value || 0) }))
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Experience (Years)
            </label>
            <input
              type="number"
              min={0}
              value={form.experience_years}
              onChange={(e) => setForm((p) => ({ ...p, experience_years: e.target.value }))}
              placeholder="e.g. 8"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Booking WhatsApp / Phone
            </label>
            <input
              type="text"
              value={form.booking_phone}
              onChange={(e) => setForm((p) => ({ ...p, booking_phone: e.target.value }))}
              placeholder="Optional (defaults to pharmacy)"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Room / Clinic Note
            </label>
            <input
              type="text"
              value={form.room_or_clinic_note}
              onChange={(e) => setForm((p) => ({ ...p, room_or_clinic_note: e.target.value }))}
              placeholder="e.g. Room 1, Pharmacy Clinic"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">Short Bio / Note</label>
            <textarea
              rows={2}
              value={form.bio}
              onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
              placeholder="e.g. Specialist in fever, diabetes, blood pressure & family medicine."
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
            className="w-4 h-4 rounded accent-emerald-600"
          />
          <span>Show this doctor live on website</span>
        </label>

        <PortalActionButton
          variant="primary"
          size="md"
          fullWidth
          loading={saving}
          loadingText="Saving Doctor…"
          disabled={!form.name.trim()}
          onClick={async () => {
            await postWebsiteAction("upsert_doctor", {
              payload: {
                ...form,
                id: form.id || undefined,
              },
            });
            notify(form.id ? "Updated doctor details on website" : "Added doctor to your website!");
            setForm({ ...EMPTY_DOCTOR });
          }}
        >
          {form.id ? "Update Doctor Profile" : "Save & Publish Doctor"}
        </PortalActionButton>
      </div>

      {/* Existing Doctors List */}
      <div className="lg:col-span-7 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Configured Doctors ({doctors.length})
          </h3>
          <span className="text-xs text-slate-500">
            Active: {doctors.filter((d) => Number(d.is_active) === 1).length}
          </span>
        </div>

        {doctors.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-2">
            <Stethoscope className="h-8 w-8 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-700">No doctors configured yet</p>
            <p className="text-xs text-slate-500">
              Doctors section is automatically hidden on your website until you add one.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {doctors.map((doc) => {
              const active = Number(doc.is_active) === 1;
              return (
                <div
                  key={doc.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-4 shadow-xs"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {doc.photo_url ? (
                      <img
                        src={resolveMediaUrl(doc.photo_url)}
                        alt={doc.name}
                        className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-emerald-600 text-white font-extrabold flex items-center justify-center shrink-0">
                        {String(doc.name || "DR")
                          .replace(/^dr\.?\s*/i, "")
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">{doc.name}</span>
                        {doc.specialization && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                            {doc.specialization}
                          </span>
                        )}
                        {!active && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">
                            Hidden
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {[doc.qualification, doc.timings, doc.days_available]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                      <p className="text-xs font-bold text-slate-800">
                        Fee: Rs. {Number(doc.consultation_fee_pkr || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          id: doc.id,
                          name: doc.name || "",
                          qualification: doc.qualification || "",
                          specialization: doc.specialization || "",
                          timings: doc.timings || "",
                          days_available: doc.days_available || "",
                          consultation_fee_pkr: Number(doc.consultation_fee_pkr || 0),
                          experience_years: doc.experience_years ? String(doc.experience_years) : "",
                          room_or_clinic_note: doc.room_or_clinic_note || "",
                          bio: doc.bio || "",
                          booking_phone: doc.booking_phone || "",
                          photo_url: doc.photo_url || "",
                          is_active: active,
                        })
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
                    >
                      <Pencil className="h-3 w-3" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setDoctorToDelete(doc)}
                      className="min-h-[36px] min-w-[36px] p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 flex items-center justify-center cursor-pointer"
                      title="Delete doctor"
                      aria-label={`Delete ${doc.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <PortalConfirmModal
        open={Boolean(doctorToDelete)}
        onClose={() => setDoctorToDelete(null)}
        onConfirm={async () => {
          if (!doctorToDelete) return;
          await postWebsiteAction("delete_doctor", { doctor_id: doctorToDelete.id });
          notify(`Removed ${doctorToDelete.name}`);
          setDoctorToDelete(null);
        }}
        loading={saving}
        tone="danger"
        title="Delete Doctor Profile?"
        description="This doctor profile and timings will be removed from your pharmacy website immediately."
        details={
          doctorToDelete
            ? `${doctorToDelete.name}${doctorToDelete.specialization ? ` • ${doctorToDelete.specialization}` : ""}`
            : undefined
        }
        confirmLabel="Yes, Delete Doctor"
      />
    </div>
  );
}

/* ========================================================================= */
/* 3. CUSTOM PHARMACY SERVICES & DIAGNOSTIC LAB TESTS TAB                    */
/* ========================================================================= */
interface ServicePriceItem {
  name: string;
  price_pkr: number;
  sample_type: string;
  report_time: string;
  note: string;
}

const EMPTY_SERVICE = {
  id: "",
  title: "",
  service_type: "lab_tests",
  subtitle: "",
  description: "",
  image_url: "",
  timings: "08:00 AM – 10:00 PM",
  home_service_available: true,
  starting_price_pkr: "",
  booking_phone: "",
  is_active: true,
  items: [
    { name: "", price_pkr: 0, sample_type: "", report_time: "", note: "" },
  ] as ServicePriceItem[],
};

export function PortalServicesTab({
  services,
  sfId,
  saving,
  uploadingImage,
  resolveMediaUrl,
  postWebsiteAction,
  uploadCompressedWebP,
  notify,
}: SharedTabProps & { services: any[] }) {
  const [form, setForm] = useState({ ...EMPTY_SERVICE, items: [...EMPTY_SERVICE.items] });
  const [serviceToDelete, setServiceToDelete] = useState<any | null>(null);

  const updateItem = (idx: number, patch: Partial<ServicePriceItem>) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Add / Edit Custom Service + Lab Tests Builder */}
      <div className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs h-fit">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-900">
              {form.id ? "Edit Custom Service / Lab" : "Create Custom Service / Lab Tests"}
            </h2>
          </div>
          {form.id && (
            <button
              type="button"
              onClick={() => setForm({ ...EMPTY_SERVICE, items: [...EMPTY_SERVICE.items] })}
              className="text-xs font-bold text-slate-500 hover:text-slate-900"
            >
              Cancel Edit
            </button>
          )}
        </div>

        <div className="rounded-xl bg-sky-50 border border-sky-200 p-3 text-[11.5px] text-sky-900">
          Add Diagnostic Lab Tests (with exact test rates), Home Sampling, BP/Sugar Check, Vaccination, or Home Nursing — with compressed cover images. Only shown on your website if active!
        </div>

        {/* Service Image Uploader (Strict Auto WebP <= 55KB) */}
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-3 min-w-0">
            {form.image_url ? (
              <img
                src={resolveMediaUrl(form.image_url)}
                alt="Service"
                className="w-16 h-12 rounded-xl object-cover border border-slate-200 bg-white shrink-0"
              />
            ) : (
              <div className="w-16 h-12 rounded-xl bg-sky-100 text-sky-700 font-bold text-xs flex items-center justify-center shrink-0">
                IMG
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">Service / Lab Cover Photo</p>
              <p className="text-[11px] text-slate-500">Auto-compressed to &lt;55 KB WebP</p>
            </div>
          </div>
          <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 text-xs font-bold shrink-0">
            <Upload className="h-3.5 w-3.5" />
            <span>{uploadingImage ? "Compressing…" : "Upload"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  void uploadCompressedWebP(
                    f,
                    "service",
                    form.id || sfId,
                    (url) => setForm((p) => ({ ...p, image_url: url })),
                    "service"
                  );
                }
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">Service Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Diagnostic Lab & Blood Tests"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Service Category</label>
            <select
              value={form.service_type}
              onChange={(e) => setForm((p) => ({ ...p, service_type: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white"
            >
              <option value="lab_tests">Diagnostic Lab &amp; Tests</option>
              <option value="home_care">Home Sampling / Nursing</option>
              <option value="clinic">BP / Sugar / Clinic Check</option>
              <option value="vaccination">Vaccination</option>
              <option value="custom">Custom Pharmacy Service</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Timings</label>
            <input
              type="text"
              value={form.timings}
              onChange={(e) => setForm((p) => ({ ...p, timings: e.target.value }))}
              placeholder="e.g. 08:00 AM - 10:00 PM"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">Short Subtitle</label>
            <input
              type="text"
              value={form.subtitle}
              onChange={(e) => setForm((p) => ({ ...p, subtitle: e.target.value }))}
              placeholder="e.g. Accurate blood tests with same-day WhatsApp reports & home sample collection"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">Details / Description</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Describe lab partnership, reporting standards, or home service details..."
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Booking Phone</label>
            <input
              type="text"
              value={form.booking_phone}
              onChange={(e) => setForm((p) => ({ ...p, booking_phone: e.target.value }))}
              placeholder="Optional (defaults to pharmacy)"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div className="flex items-end pb-1.5">
            <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.home_service_available}
                onChange={(e) =>
                  setForm((p) => ({ ...p, home_service_available: e.target.checked }))
                }
                className="w-4 h-4 rounded accent-emerald-600"
              />
              <span>Home Collection / Visit Available</span>
            </label>
          </div>
        </div>

        {/* Dynamic Lab Tests & Price List Builder */}
        <div className="space-y-2.5 pt-2 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">
              Tests / Packages &amp; Prices (PKR)
            </span>
            <button
              type="button"
              onClick={() =>
                setForm((p) => ({
                  ...p,
                  items: [
                    ...p.items,
                    { name: "", price_pkr: 0, sample_type: "", report_time: "", note: "" },
                  ],
                }))
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-bold"
            >
              <Plus className="h-3 w-3" />
              <span>Add Test / Item</span>
            </button>
          </div>

          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {form.items.map((item, idx) => (
              <div
                key={idx}
                className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 space-y-2"
              >
                <div className="grid grid-cols-12 gap-2">
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateItem(idx, { name: e.target.value })}
                    placeholder="Test / item name (e.g. CBC Blood Test)"
                    className="col-span-7 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <input
                    type="number"
                    min={0}
                    value={item.price_pkr}
                    onChange={(e) =>
                      updateItem(idx, { price_pkr: Math.max(0, Number(e.target.value || 0)) })
                    }
                    placeholder="PKR"
                    className="col-span-3 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        items: p.items.filter((_, i) => i !== idx),
                      }))
                    }
                    className="col-span-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 flex items-center justify-center"
                    title="Remove item"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={item.sample_type}
                    onChange={(e) => updateItem(idx, { sample_type: e.target.value })}
                    placeholder="Sample (e.g. Blood / Urine)"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px]"
                  />
                  <input
                    type="text"
                    value={item.report_time}
                    onChange={(e) => updateItem(idx, { report_time: e.target.value })}
                    placeholder="Report time (e.g. Same Day / 6 hrs)"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px]"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
            className="w-4 h-4 rounded accent-emerald-600"
          />
          <span>Publish this service live on website</span>
        </label>

        <PortalActionButton
          variant="primary"
          size="md"
          fullWidth
          loading={saving}
          loadingText="Saving Service…"
          disabled={!form.title.trim()}
          onClick={async () => {
            const cleanItems = form.items.filter((i) => i.name.trim());
            await postWebsiteAction("upsert_service", {
              payload: {
                ...form,
                id: form.id || undefined,
                items: cleanItems,
              },
            });
            notify(form.id ? "Updated custom service!" : "Published custom service on website!");
            setForm({ ...EMPTY_SERVICE, items: [...EMPTY_SERVICE.items] });
          }}
        >
          {form.id ? "Update Service & Prices" : "Save & Publish Service"}
        </PortalActionButton>
      </div>

      {/* Existing Custom Services List */}
      <div className="lg:col-span-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Active &amp; Saved Custom Services ({services.length})
          </h3>
        </div>

        {services.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-2">
            <FlaskConical className="h-8 w-8 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-700">No custom services added yet</p>
            <p className="text-xs text-slate-500">
              Create Lab Tests, Home Nursing, Vaccination, or Health Checkups — they automatically appear on your website once added.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {services.map((svc) => {
              const items: any[] = Array.isArray(svc.items) ? svc.items : [];
              const active = Number(svc.is_active) === 1;
              return (
                <div
                  key={svc.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {svc.image_url && (
                        <img
                          src={resolveMediaUrl(svc.image_url)}
                          alt={svc.title}
                          className="w-16 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
                        />
                      )}
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-slate-900">{svc.title}</span>
                          {!active && (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">
                              Hidden
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          {svc.timings && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {svc.timings}
                            </span>
                          )}
                          {svc.booking_phone && (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-3 w-3" /> {svc.booking_phone}
                            </span>
                          )}
                          <span>• {items.length} test(s)/item(s)</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            id: svc.id,
                            title: svc.title || "",
                            service_type: svc.service_type || "lab_tests",
                            subtitle: svc.subtitle || "",
                            description: svc.description || "",
                            image_url: svc.image_url || "",
                            timings: svc.timings || "",
                            home_service_available: Boolean(svc.home_service_available),
                            starting_price_pkr: svc.starting_price_pkr
                              ? String(svc.starting_price_pkr)
                              : "",
                            booking_phone: svc.booking_phone || "",
                            is_active: active,
                            items:
                              items.length > 0
                                ? items.map((i) => ({
                                    name: i.name || "",
                                    price_pkr: Number(i.price_pkr || 0),
                                    sample_type: i.sample_type || "",
                                    report_time: i.report_time || "",
                                    note: i.note || "",
                                  }))
                                : [{ name: "", price_pkr: 0, sample_type: "", report_time: "", note: "" }],
                          })
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
                      >
                        <Pencil className="h-3 w-3" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setServiceToDelete(svc)}
                        className="min-h-[36px] min-w-[36px] p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 flex items-center justify-center cursor-pointer"
                        title="Delete service"
                        aria-label={`Delete ${svc.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {items.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                      {items.slice(0, 6).map((it, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-semibold text-slate-700"
                        >
                          {it.name} —{" "}
                          <strong className="text-slate-900">
                            Rs. {Number(it.price_pkr || 0).toLocaleString()}
                          </strong>
                        </span>
                      ))}
                      {items.length > 6 && (
                        <span className="px-2 py-1 text-[11px] font-bold text-emerald-700">
                          +{items.length - 6} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <PortalConfirmModal
        open={Boolean(serviceToDelete)}
        onClose={() => setServiceToDelete(null)}
        onConfirm={async () => {
          if (!serviceToDelete) return;
          await postWebsiteAction("delete_service", { service_id: serviceToDelete.id });
          notify(`Deleted service "${serviceToDelete.title}"`);
          setServiceToDelete(null);
        }}
        loading={saving}
        tone="danger"
        title="Delete Custom Service / Lab?"
        description="This service and its entire test/price list will be permanently removed from your live website."
        details={serviceToDelete ? serviceToDelete.title : undefined}
        confirmLabel="Yes, Delete Service"
      />
    </div>
  );
}

"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion, AnimatePresence } from "framer-motion"
import { Plus, Trash2, Loader2, Check, Star, GripVertical, X } from "lucide-react"
import { formatMoney } from "@/lib/utils"
import { toast } from "sonner"
import { insertPlanResilient, updatePlanResilient, withPlanDefaults } from "@/lib/plan-resilience"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

type PricingAggressiveness = "conservative" | "balanced" | "aggressive"

type Plan = {
  id: string
  name: string
  description: string | null
  price_monthly: number
  price_yearly: number
  trial_days: number
  features: string[]
  is_popular: boolean
  badge_color: string
  is_active: boolean
  sort_order: number
  stripe_price_id_monthly: string | null
  stripe_price_id_yearly: string | null
  stripe_product_id: string | null
  dynamic_pricing_enabled: boolean
  pricing_aggressiveness: PricingAggressiveness
}

type NewPlan = Omit<Plan, "id" | "sort_order">

const DEFAULT_PLAN: NewPlan = {
  name: "",
  description: "",
  price_monthly: 0,
  price_yearly: 0,
  trial_days: 0,
  features: [""],
  is_popular: false,
  badge_color: "#6366F1",
  is_active: true,
  stripe_price_id_monthly: null,
  stripe_price_id_yearly: null,
  stripe_product_id: null,
  dynamic_pricing_enabled: false,
  pricing_aggressiveness: "balanced",
}

const AGGRESSIVENESS_OPTIONS: { value: PricingAggressiveness; label: string; desc: string }[] = [
  { value: "conservative", label: "Conservative", desc: "±25% — safer, fewer variants" },
  { value: "balanced",     label: "Balanced",     desc: "±50% — recommended default" },
  { value: "aggressive",   label: "Aggressive",   desc: "±90% — fast learning, more variance" },
]

function SortablePlanCard({
  plan, billingPeriod, onEdit, onDelete, onTogglePopular,
}: {
  plan: Plan
  billingPeriod: "monthly" | "yearly"
  onEdit: (plan: Plan) => void
  onDelete: (id: string) => void
  onTogglePopular: (plan: Plan) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: plan.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const displayPrice = billingPeriod === "yearly" ? plan.price_yearly : plan.price_monthly
  const yearlyDiscount = plan.price_monthly > 0 && plan.price_yearly > 0
    ? Math.round((1 - (plan.price_yearly / 12) / plan.price_monthly) * 100)
    : 0

  return (
    <div ref={setNodeRef} style={style} className={`bg-[#111114] border rounded-xl p-5 relative group ${
      plan.is_popular ? "border-indigo-500/40" : "border-white/6"
    } ${isDragging ? "z-50 shadow-2xl" : ""}`}>
      {plan.is_popular && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
          <span className="bg-indigo-600 text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1">
            <Star className="w-2.5 h-2.5" /> Most Popular
          </span>
        </div>
      )}

      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-4 left-3 cursor-grab active:cursor-grabbing text-[#3F3F46] hover:text-[#71717A] transition-colors opacity-0 group-hover:opacity-100"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      <div className="flex items-start justify-between mb-3 pl-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white">{plan.name}</h3>
          {plan.description && <p className="text-xs text-[#71717A] mt-0.5">{plan.description}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePopular(plan) }}
            title={plan.is_popular ? "Remove popular badge" : "Mark as popular"}
            className={`p-1.5 rounded transition-colors ${plan.is_popular ? "text-indigo-400 hover:text-indigo-300" : "text-[#3F3F46] hover:text-[#71717A]"}`}
          >
            <Star className="w-3.5 h-3.5" fill={plan.is_popular ? "currentColor" : "none"} />
          </button>
          <button onClick={() => onEdit(plan)} className="p-1.5 text-[#52525B] hover:text-white transition-colors rounded">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button onClick={() => onDelete(plan.id)} className="p-1.5 text-[#52525B] hover:text-red-400 transition-colors rounded">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="mb-4 pl-2">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-2xl font-semibold text-white">{formatMoney(displayPrice)}</span>
          <span className="text-xs text-[#71717A]">/{billingPeriod === "yearly" ? "yr" : "mo"}</span>
        </div>
        {billingPeriod === "yearly" && yearlyDiscount > 0 && (
          <span className="text-xs text-emerald-400">Save {yearlyDiscount}% vs monthly</span>
        )}
        {billingPeriod === "monthly" && plan.price_yearly > 0 && yearlyDiscount > 0 && (
          <span className="text-xs text-[#52525B]">
            {formatMoney(plan.price_yearly)}/yr available
          </span>
        )}
        {plan.trial_days > 0 && (
          <p className="text-xs text-indigo-400 mt-0.5">{plan.trial_days}-day free trial</p>
        )}
      </div>

      <ul className="space-y-1.5 mb-4 pl-2">
        {(plan.features ?? []).slice(0, 4).map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-[#A1A1AA]">
            <Check className="w-3 h-3 text-indigo-400 mt-0.5 flex-shrink-0" />
            {f}
          </li>
        ))}
        {(plan.features ?? []).length > 4 && (
          <li className="text-xs text-[#52525B] pl-5">+{plan.features.length - 4} more</li>
        )}
      </ul>

      <div className="flex items-center gap-2 border-t border-white/6 pt-3 pl-2">
        <div className={`w-2 h-2 rounded-full ${plan.is_active ? "bg-emerald-400" : "bg-[#52525B]"}`} />
        <span className="text-xs text-[#71717A]">{plan.is_active ? "Active" : "Inactive"}</span>
        {plan.stripe_product_id && (
          <span className="ml-auto text-[10px] font-mono text-[#3F3F46] truncate max-w-[120px]">
            {plan.stripe_product_id.slice(0, 16)}…
          </span>
        )}
      </div>
    </div>
  )
}

export default function PlansPage() {
  const supabase = createClient()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Plan | null>(null)
  const [form, setForm] = useState<NewPlan>(DEFAULT_PLAN)
  const [saving, setSaving] = useState(false)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly")

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => { loadPlans() }, [])

  async function loadPlans() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
    if (!profile) return
    setAccountId(profile.account_id)
    const { data } = await supabase.from("plans").select("*").eq("account_id", profile.account_id).order("sort_order")
    // Apply safe defaults so the UI never crashes when columns are missing (pre-migration)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setPlans((data ?? []).map((p: any) => withPlanDefaults(p) as Plan))
    setLoading(false)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = plans.findIndex(p => p.id === active.id)
    const newIndex = plans.findIndex(p => p.id === over.id)
    const reordered = arrayMove(plans, oldIndex, newIndex)
    setPlans(reordered)

    // Persist sort order
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from("plans").update({ sort_order: i }).eq("id", reordered[i].id)
    }
  }

  function openNew() {
    setEditing(null)
    setForm(DEFAULT_PLAN)
    setShowModal(true)
  }

  function openEdit(plan: Plan) {
    setEditing(plan)
    setForm({
      name: plan.name,
      description: plan.description,
      price_monthly: plan.price_monthly,
      price_yearly: plan.price_yearly,
      trial_days: plan.trial_days,
      features: plan.features?.length ? plan.features : [""],
      is_popular: plan.is_popular,
      badge_color: plan.badge_color,
      is_active: plan.is_active,
      stripe_price_id_monthly: plan.stripe_price_id_monthly,
      stripe_price_id_yearly: plan.stripe_price_id_yearly,
      stripe_product_id: plan.stripe_product_id,
      dynamic_pricing_enabled: plan.dynamic_pricing_enabled ?? false,
      pricing_aggressiveness: (plan.pricing_aggressiveness ?? "balanced") as PricingAggressiveness,
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!accountId || !form.name.trim()) { toast.error("Plan name is required"); return }
    setSaving(true)

    let savedPlanId: string | null = null

    if (editing) {
      const result = await updatePlanResilient<{ id: string }>(supabase, editing.id, { ...form })
      if (result.error) { toast.error(result.error.message); setSaving(false); return }
      savedPlanId = editing.id
      if (result.droppedFields.length > 0) {
        toast.success("Plan updated — some advanced settings need a database update to take effect.", {
          description: `Columns not yet in DB: ${result.droppedFields.join(", ")}. Run: supabase db push`,
          duration: 8000,
        })
      } else {
        toast.success("Plan updated")
      }
    } else {
      const result = await insertPlanResilient<{ id: string }>(supabase, {
        ...form,
        account_id: accountId,
        sort_order: plans.length,
      })
      if (result.error) { toast.error(result.error.message); setSaving(false); return }
      savedPlanId = result.data?.id ?? null
      if (result.droppedFields.length > 0) {
        toast.success("Plan created — some advanced settings need a database update to take effect.", {
          description: `Columns not yet in DB: ${result.droppedFields.join(", ")}. Run: supabase db push`,
          duration: 8000,
        })
      } else {
        toast.success("Plan created")
      }
    }

    // Cold-start value-based pricing candidates (Claude Opus, falls back to mechanical)
    if (savedPlanId && form.dynamic_pricing_enabled && form.price_monthly > 0) {
      fetch("/api/pricing/cold-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: savedPlanId }),
      }).catch(() => {
        // Non-fatal — candidates are bootstrapped lazily on first impression anyway
      })
    }

    setSaving(false)
    setShowModal(false)
    loadPlans()
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this plan? This cannot be undone.")) return
    await supabase.from("plans").delete().eq("id", id)
    toast.success("Plan deleted")
    loadPlans()
  }

  async function handleTogglePopular(plan: Plan) {
    const newVal = !plan.is_popular
    // Optionally clear all others if setting popular
    if (newVal) {
      await supabase.from("plans").update({ is_popular: false }).eq("account_id", accountId!)
    }
    await supabase.from("plans").update({ is_popular: newVal }).eq("id", plan.id)
    loadPlans()
  }

  function addFeature() {
    setForm({ ...form, features: [...form.features, ""] })
  }

  function updateFeature(i: number, v: string) {
    setForm({ ...form, features: form.features.map((f, idx) => idx === i ? v : f) })
  }

  function removeFeature(i: number) {
    setForm({ ...form, features: form.features.filter((_, idx) => idx !== i) })
  }

  // Auto-calculate yearly price at 20% discount when monthly changes
  function handleMonthlyChange(cents: number) {
    const yearly = form.price_yearly === 0 || form.price_yearly === Math.round(form.price_monthly * 12 * 0.8)
      ? Math.round(cents * 12 * 0.8)
      : form.price_yearly
    setForm({ ...form, price_monthly: cents, price_yearly: yearly })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-[#71717A]" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">Plans</h1>
          <p className="text-sm text-[#71717A]">{plans.length} plan{plans.length !== 1 ? "s" : ""} · Drag to reorder</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Billing period toggle */}
          <div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5">
            <button
              onClick={() => setBillingPeriod("monthly")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                billingPeriod === "monthly" ? "bg-white/10 text-white" : "text-[#71717A] hover:text-[#A1A1AA]"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod("yearly")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                billingPeriod === "yearly" ? "bg-white/10 text-white" : "text-[#71717A] hover:text-[#A1A1AA]"
              }`}
            >
              Yearly
              <span className="bg-emerald-500/20 text-emerald-400 text-[9px] px-1.5 py-0.5 rounded-full font-semibold">
                -20%
              </span>
            </button>
          </div>
          <button onClick={openNew} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> New plan
          </button>
        </div>
      </div>

      {plans.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded-xl p-12 text-center">
          <p className="text-[#71717A] mb-4">No plans yet</p>
          <button onClick={openNew} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Create your first plan
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={plans.map(p => p.id)} strategy={verticalListSortingStrategy}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {plans.map(plan => (
                <SortablePlanCard
                  key={plan.id}
                  plan={plan}
                  billingPeriod={billingPeriod}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onTogglePopular={handleTogglePopular}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="bg-[#111114] border border-white/10 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-heading text-lg font-semibold text-white">
                  {editing ? "Edit plan" : "New plan"}
                </h2>
                <button onClick={() => setShowModal(false)} className="text-[#52525B] hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#A1A1AA] mb-1.5 block">Name <span className="text-red-400">*</span></label>
                    <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="hatch-input" placeholder="Pro" />
                  </div>
                  <div>
                    <label className="text-xs text-[#A1A1AA] mb-1.5 block">Free trial (days)</label>
                    <input type="number" value={form.trial_days} onChange={e => setForm({...form, trial_days: Number(e.target.value)})} className="hatch-input font-mono" min={0} />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[#A1A1AA] mb-1.5 block">Description</label>
                  <input value={form.description ?? ""} onChange={e => setForm({...form, description: e.target.value})} className="hatch-input" placeholder="Perfect for growing teams" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#A1A1AA] mb-1.5 block">Monthly price ($)</label>
                    <input
                      type="number"
                      value={form.price_monthly / 100}
                      onChange={e => handleMonthlyChange(Math.round(Number(e.target.value) * 100))}
                      className="hatch-input font-mono"
                      min={0} step={0.01}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#A1A1AA] mb-1.5 block">
                      Yearly price ($)
                      {form.price_monthly > 0 && (
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, price_yearly: Math.round(f.price_monthly * 12 * 0.8) }))}
                          className="ml-2 text-indigo-400 hover:text-indigo-300 text-[10px] transition-colors"
                        >
                          Auto (-20%)
                        </button>
                      )}
                    </label>
                    <input
                      type="number"
                      value={form.price_yearly / 100}
                      onChange={e => setForm({...form, price_yearly: Math.round(Number(e.target.value) * 100)})}
                      className="hatch-input font-mono"
                      min={0} step={0.01}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[#A1A1AA] mb-1.5 block">Features</label>
                  {form.features.map((f, i) => (
                    <div key={i} className="flex gap-2 mb-1.5">
                      <input value={f} onChange={e => updateFeature(i, e.target.value)} className="hatch-input flex-1" placeholder="Feature description" />
                      {form.features.length > 1 && (
                        <button onClick={() => removeFeature(i)} className="text-[#52525B] hover:text-red-400 transition-colors px-1">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button onClick={addFeature} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 mt-1 transition-colors">
                    <Plus className="w-3 h-3" /> Add feature
                  </button>
                </div>

                {/* Stripe IDs */}
                <div className="pt-2 border-t border-white/6">
                  <label className="text-xs text-[#52525B] mb-2 block">Stripe IDs (optional — linked when you connect Stripe)</label>
                  <div className="space-y-2">
                    <input
                      value={form.stripe_product_id ?? ""}
                      onChange={e => setForm({...form, stripe_product_id: e.target.value || null})}
                      className="hatch-input font-mono text-xs"
                      placeholder="prod_..."
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={form.stripe_price_id_monthly ?? ""}
                        onChange={e => setForm({...form, stripe_price_id_monthly: e.target.value || null})}
                        className="hatch-input font-mono text-xs"
                        placeholder="price_... (monthly)"
                      />
                      <input
                        value={form.stripe_price_id_yearly ?? ""}
                        onChange={e => setForm({...form, stripe_price_id_yearly: e.target.value || null})}
                        className="hatch-input font-mono text-xs"
                        placeholder="price_... (yearly)"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer" onClick={() => setForm(f => ({...f, is_popular: !f.is_popular}))}>
                    <div className={`w-8 h-5 rounded-full transition-colors relative ${form.is_popular ? "bg-indigo-600" : "bg-white/10"}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.is_popular ? "left-3.5" : "left-0.5"}`} />
                    </div>
                    <span className="text-xs text-[#A1A1AA]">Most popular</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer" onClick={() => setForm(f => ({...f, is_active: !f.is_active}))}>
                    <div className={`w-8 h-5 rounded-full transition-colors relative ${form.is_active ? "bg-emerald-600" : "bg-white/10"}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.is_active ? "left-3.5" : "left-0.5"}`} />
                    </div>
                    <span className="text-xs text-[#A1A1AA]">Active</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer" onClick={() => setForm(f => ({...f, dynamic_pricing_enabled: !f.dynamic_pricing_enabled}))}>
                    <div className={`w-8 h-5 rounded-full transition-colors relative ${form.dynamic_pricing_enabled ? "bg-amber-500" : "bg-white/10"}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.dynamic_pricing_enabled ? "left-3.5" : "left-0.5"}`} />
                    </div>
                    <span className="text-xs text-[#A1A1AA]">
                      Dynamic pricing
                      {form.dynamic_pricing_enabled && <span className="ml-1 text-amber-400">⚡</span>}
                    </span>
                  </label>
                </div>
                {form.dynamic_pricing_enabled && (
                  <div className="space-y-3">
                    <p className="text-[11px] text-amber-400/80 bg-amber-500/8 border border-amber-500/15 rounded-lg px-3 py-2">
                      Hatch will A/B test prices around your anchor using Thompson sampling and serve the highest-revenue price to each user.
                    </p>
                    <div>
                      <label className="text-xs text-[#A1A1AA] mb-2 block">Exploration aggressiveness</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {AGGRESSIVENESS_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setForm(f => ({ ...f, pricing_aggressiveness: opt.value }))}
                            className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-all ${
                              form.pricing_aggressiveness === opt.value
                                ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                                : "border-white/8 bg-white/3 text-[#71717A] hover:border-white/15 hover:text-[#A1A1AA]"
                            }`}
                          >
                            <div className="font-semibold mb-0.5">{opt.label}</div>
                            <div className="text-[10px] opacity-70 leading-tight">{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button onClick={() => setShowModal(false)} className="flex-1 hatch-btn-secondary">Cancel</button>
                  <button onClick={handleSave} disabled={saving} className="flex-1 hatch-btn-primary">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {editing ? "Save changes" : "Create plan"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .hatch-input { width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 12px;font-size:14px;color:white;outline:none;transition:all 0.15s; }
        .hatch-input::placeholder { color:#52525B; }
        .hatch-input:focus { border-color:rgba(99,102,241,0.5);box-shadow:0 0 0 1px rgba(99,102,241,0.3); }
        .hatch-btn-primary { display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#6366F1;color:white;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.15s; }
        .hatch-btn-primary:hover { background:#5055E8; }
        .hatch-btn-primary:disabled { opacity:0.5;cursor:default; }
        .hatch-btn-secondary { display:inline-flex;align-items:center;justify-content:center;gap:6px;background:rgba(255,255,255,0.05);color:#A1A1AA;border:1px solid rgba(255,255,255,0.1);padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;transition:all 0.15s; }
        .hatch-btn-secondary:hover { background:rgba(255,255,255,0.08);color:white; }
      `}</style>
    </div>
  )
}

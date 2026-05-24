"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  TrendingUp, Zap, Brain, Activity, ChevronDown, ChevronUp,
  Settings2, Pause, RotateCcw, CheckCircle2, AlertCircle,
  BarChart3, Target, Layers, Clock, ArrowUpRight, ArrowDownRight,
  Minus, Info
} from "lucide-react"
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine, CartesianGrid
} from "recharts"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import type { PricingAggressiveness } from "@/lib/price-ladder"

// ─── Types ───────────────────────────────────────────────────────────────────

interface PosteriorRow {
  price_candidate_id: string
  segment_hash: string
  alpha: number
  beta: number
  impressions: number
  conversions: number
  revenue_cents: number
  updated_at: string
}

interface Candidate {
  id: string
  plan_id: string
  price_cents: number
  is_anchor: boolean
  is_active: boolean
  interval: string
  generated_by: string
  created_at: string
  posterior: PosteriorRow | null
}

interface ElasticityPoint {
  price_cents: number
  impressions: number
  conversions: number
  conv_rate: number
  rpi_cents: number
  ci_low: number
  ci_high: number
}

interface VariableImportance {
  variable_name: string
  importance_score: number
  optimal_price_by_value: Record<string, number>
  revenue_spread_cents: number
  evidence: Record<string, unknown>
}

interface ScientistRun {
  id: string
  plan_id: string
  run_type: string
  engine: string
  reasoning: string | null
  actions: unknown[]
  data_maturity: number
  duration_ms: number
  created_at: string
}

interface PlanData {
  candidates: Candidate[]
  latestElasticity: {
    curve: ElasticityPoint[]
    optimal_price_cents: number | null
    optimal_rpi_cents: number | null
    confidence: number
    computed_at: string
  } | null
  variableImportance: VariableImportance[]
  scientistRuns: ScientistRun[]
  maturity: {
    total_impressions: number
    total_conversions: number
    maturity_score: number
    preferred_engine: string
  } | null
  demandModel: {
    n_obs: number
    anchor_cents: number
    updated_at: string
  } | null
  totalImpressions: number
  totalRevenueCents: number
  incrementalRevenueCents: number | null
  anchorConvRate: number | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

function fmtPct(r: number) {
  return `${(r * 100).toFixed(1)}%`
}

function convRate(post: PosteriorRow | null) {
  if (!post || post.impressions === 0) return null
  return post.conversions / post.impressions
}

function rpi(post: PosteriorRow | null, priceCents: number) {
  const cr = convRate(post)
  if (cr === null) return null
  return cr * priceCents
}

function betaCI(alpha: number, beta: number): [number, number] {
  const n = alpha + beta - 2
  if (n <= 0) return [0, 1]
  const p = (alpha - 1) / n
  const se = Math.sqrt(p * (1 - p) / Math.max(n, 1))
  return [Math.max(0, p - 1.96 * se), Math.min(1, p + 1.96 * se)]
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function engineColor(engine: string) {
  return engine === "claude" ? "text-violet-400" : "text-cyan-400"
}

function engineLabel(engine: string) {
  return engine === "claude" ? "Claude" : "In-house"
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PulseDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${active ? "bg-emerald-400" : "bg-[#52525B]"}`} />
    </span>
  )
}

function MaturityBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = score < 0.3 ? "bg-[#52525B]" : score < 0.6 ? "bg-amber-500" : "bg-emerald-500"
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-[#71717A] tabular-nums">{pct}%</span>
    </div>
  )
}

// ─── Demand Curve Panel ───────────────────────────────────────────────────────

function DemandCurvePanel({ elasticity, anchorCents }: {
  elasticity: PlanData["latestElasticity"]
  anchorCents: number
}) {
  if (!elasticity || !elasticity.curve || elasticity.curve.length < 2) {
    return (
      <div className="h-[120px] flex items-center justify-center text-xs text-[#3F3F46]">
        <span>Collecting data — curve appears after ≥30 impressions</span>
      </div>
    )
  }

  const data = elasticity.curve.map(p => ({
    price: p.price_cents / 100,
    rpi: p.rpi_cents / 100,
    lo: p.ci_low * p.price_cents / 100,
    hi: p.ci_high * p.price_cents / 100,
    conv: p.conv_rate,
  }))

  const maxRpi = Math.max(...data.map(d => d.hi))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-[#71717A] font-medium uppercase tracking-wider">Demand curve</span>
        {elasticity.optimal_price_cents && (
          <span className="text-[11px] text-emerald-400 font-semibold">
            Optimal: {fmt(elasticity.optimal_price_cents)}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rpiGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366F1" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#6366F1" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366F1" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#6366F1" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="price" hide />
          <YAxis hide domain={[0, maxRpi * 1.15]} />
          <Tooltip
            contentStyle={{ background: "#18181B", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 11 }}
            formatter={(v: unknown) => [`$${(v as number).toFixed(2)}`, "RPI"]}
            labelFormatter={(v: unknown) => `Price: $${v}`}
          />
          <Area type="monotone" dataKey="hi" fill="url(#ciGrad)" stroke="none" />
          <Area type="monotone" dataKey="lo" fill="#0D0D0F" stroke="none" />
          <Area type="monotone" dataKey="rpi" stroke="#6366F1" strokeWidth={2} fill="url(#rpiGrad)" dot={false} />
          {anchorCents && (
            <ReferenceLine x={anchorCents / 100} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 3" />
          )}
          {elasticity.optimal_price_cents && (
            <ReferenceLine x={elasticity.optimal_price_cents / 100} stroke="#10B981" strokeDasharray="4 3" />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── A/B Test Table ───────────────────────────────────────────────────────────

function ABTestPanel({ candidates, anchorCents }: {
  candidates: Candidate[]
  anchorCents: number
}) {
  const active = candidates.filter(c => c.is_active)
  if (active.length === 0) {
    return (
      <div className="text-xs text-[#3F3F46] py-3 text-center">No active price candidates</div>
    )
  }

  const rpis = active.map(c => rpi(c.posterior, c.price_cents) ?? 0)
  const maxRpi = Math.max(...rpis, 0.01)
  const leaderRpi = maxRpi

  return (
    <div>
      <span className="text-[11px] text-[#71717A] font-medium uppercase tracking-wider">Live A/B test</span>
      <div className="mt-2 space-y-1.5">
        {active.map((c, i) => {
          const post = c.posterior
          const cr = convRate(post)
          const r = rpi(post, c.price_cents)
          const ci = post ? betaCI(post.alpha, post.beta) : null
          const impr = post?.impressions ?? 0
          const isLeader = r !== null && r === leaderRpi && r > 0
          const isAnchor = c.is_anchor
          const barPct = r !== null ? (r / maxRpi) * 100 : 0
          const hasData = impr >= 5

          return (
            <div key={c.id} className={`rounded-lg px-3 py-2 border transition-all ${
              isLeader && hasData
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-white/5 bg-white/2"
            }`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-white tabular-nums">{fmt(c.price_cents)}</span>
                  {isAnchor && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-white/8 text-[#71717A] rounded-full uppercase tracking-wide font-semibold">
                      anchor
                    </span>
                  )}
                  {isLeader && hasData && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded-full uppercase tracking-wide font-semibold">
                      leader
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[#71717A] tabular-nums">
                  {hasData ? (
                    <>
                      <span>{impr.toLocaleString()} shown</span>
                      {cr !== null && (
                        <span className={isLeader ? "text-emerald-400" : "text-[#A1A1AA]"}>
                          {fmtPct(cr)} conv
                        </span>
                      )}
                      {r !== null && (
                        <span className={`font-semibold ${isLeader ? "text-emerald-400" : "text-white"}`}>
                          {fmt(r)}/imp
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[#3F3F46]">{impr} shown — warming up</span>
                  )}
                </div>
              </div>
              {/* RPI bar */}
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${barPct}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className={`h-full rounded-full ${isLeader && hasData ? "bg-emerald-400" : "bg-indigo-500/60"}`}
                />
              </div>
              {ci && hasData && (
                <div className="mt-1 text-[10px] text-[#52525B]">
                  95% CI: {fmtPct(ci[0])} – {fmtPct(ci[1])}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Variable Parfaite Panel ──────────────────────────────────────────────────

function VariableParfaitePanel({ vi }: { vi: VariableImportance[] }) {
  if (vi.length === 0) {
    return (
      <div className="text-xs text-[#3F3F46] py-2 text-center">
        Variable analysis runs after ≥100 impressions
      </div>
    )
  }

  const top = vi[0]
  const entries = Object.entries(top.optimal_price_by_value)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 4)

  if (entries.length === 0) return null

  const maxPrice = Math.max(...entries.map(([, v]) => v as number))

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] text-[#71717A] font-medium uppercase tracking-wider">Top price signal</span>
        <span className="text-[10px] font-semibold text-violet-400 bg-violet-400/10 px-1.5 py-0.5 rounded-full">
          {top.variable_name}
        </span>
        <span className="ml-auto text-[10px] text-[#52525B]">
          {Math.round(top.importance_score * 100)}% signal
        </span>
      </div>
      <div className="space-y-1.5">
        {entries.map(([val, price]) => {
          const pct = Math.round(((price as number) / maxPrice) * 100)
          return (
            <div key={val} className="flex items-center gap-2">
              <span className="text-[11px] text-[#71717A] w-20 truncate">{val}</span>
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500/70 rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] text-white font-semibold tabular-nums w-10 text-right">
                {fmt(price as number)}
              </span>
            </div>
          )
        })}
      </div>
      {top.revenue_spread_cents > 0 && (
        <p className="mt-2 text-[10px] text-[#52525B]">
          Revenue spread: {fmt(top.revenue_spread_cents)}/imp between best and worst segment
        </p>
      )}
    </div>
  )
}

// ─── Incremental Revenue Panel ────────────────────────────────────────────────

function IncrementalRevenuePanel({ data, anchorCents }: {
  data: PlanData
  anchorCents: number
}) {
  const { totalImpressions, totalRevenueCents, incrementalRevenueCents, anchorConvRate } = data

  if (totalImpressions < 50 || incrementalRevenueCents === null) {
    return (
      <div className="text-xs text-[#3F3F46] py-2 text-center">
        Proof available after ≥50 impressions
      </div>
    )
  }

  const lift = incrementalRevenueCents
  const liftPct = lift / Math.max(totalRevenueCents - lift, 1)
  const positive = lift >= 0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-1.5 text-sm font-semibold ${positive ? "text-emerald-400" : "text-red-400"}`}>
          {positive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
          {positive ? "+" : ""}{fmt(lift)}
        </div>
        <span className="text-xs text-[#71717A]">vs fixed anchor price</span>
        <span className={`text-xs font-semibold ml-auto ${positive ? "text-emerald-400" : "text-red-400"}`}>
          {positive ? "+" : ""}{(liftPct * 100).toFixed(1)}%
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-white/3 rounded-lg p-2.5">
          <div className="text-xs text-[#52525B] mb-0.5">Actual revenue</div>
          <div className="text-sm font-semibold text-white">{fmt(totalRevenueCents)}</div>
        </div>
        <div className="bg-white/3 rounded-lg p-2.5">
          <div className="text-xs text-[#52525B] mb-0.5">Counterfactual</div>
          <div className="text-sm font-semibold text-[#71717A]">{fmt(totalRevenueCents - lift)}</div>
        </div>
        <div className="bg-white/3 rounded-lg p-2.5">
          <div className="text-xs text-[#52525B] mb-0.5">Impressions</div>
          <div className="text-sm font-semibold text-white">{totalImpressions.toLocaleString()}</div>
        </div>
      </div>

      <p className="text-[10px] text-[#52525B] leading-relaxed">
        Counterfactual = {totalImpressions.toLocaleString()} impressions × anchor conv rate ({anchorConvRate !== null ? fmtPct(anchorConvRate) : "?"}) × {fmt(anchorCents)}.
        Dynamic pricing generated {fmt(totalRevenueCents)} actual.
      </p>
    </div>
  )
}

// ─── Founder Controls Panel ───────────────────────────────────────────────────

function FounderControlsPanel({
  plan,
  planData,
  onUpdate,
}: {
  plan: Record<string, unknown>
  planData: PlanData
  onUpdate: () => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [resetting, setResetting] = useState(false)

  const [aggressiveness, setAggressiveness] = useState<PricingAggressiveness>(
    (plan.pricing_aggressiveness as PricingAggressiveness) ?? "balanced"
  )
  const [floorDollars, setFloorDollars] = useState(
    plan.price_floor_cents ? String((plan.price_floor_cents as number) / 100) : ""
  )
  const [ceilDollars, setCeilDollars] = useState(
    plan.price_ceiling_cents ? String((plan.price_ceiling_cents as number) / 100) : ""
  )

  async function handleSave() {
    setSaving(true)
    const updates: Record<string, unknown> = { pricing_aggressiveness: aggressiveness }
    if (floorDollars) updates.price_floor_cents = Math.round(parseFloat(floorDollars) * 100)
    else updates.price_floor_cents = null
    if (ceilDollars) updates.price_ceiling_cents = Math.round(parseFloat(ceilDollars) * 100)
    else updates.price_ceiling_cents = null

    const { error } = await supabase
      .from("plans")
      .update(updates)
      .eq("id", plan.id as string)

    setSaving(false)
    if (error) toast.error(error.message)
    else { toast.success("Settings saved"); onUpdate() }
  }

  async function handleFreeze() {
    if (!confirm("Freeze exploration? Only the anchor price will be shown until you re-enable.")) return
    setFreezing(true)
    const res = await fetch("/api/pricing/freeze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: plan.id }),
    })
    setFreezing(false)
    if (res.ok) {
      const d = await res.json()
      toast.success(`Frozen — ${d.deactivated} candidate${d.deactivated !== 1 ? "s" : ""} paused`)
      onUpdate()
    } else {
      toast.error("Freeze failed")
    }
  }

  async function handleReset() {
    if (!confirm("Reset all pricing data for this plan? This will delete all non-anchor candidates and wipe the Bayesian model. This cannot be undone.")) return
    setResetting(true)
    const res = await fetch("/api/pricing/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: plan.id }),
    })
    setResetting(false)
    if (res.ok) {
      toast.success("Pricing reset — fresh start")
      onUpdate()
    } else {
      toast.error("Reset failed")
    }
  }

  const LEVELS: { value: PricingAggressiveness; label: string; desc: string; color: string }[] = [
    { value: "conservative", label: "Conservative", desc: "±25%", color: "border-cyan-500/40 bg-cyan-500/8 text-cyan-300" },
    { value: "balanced",     label: "Balanced",     desc: "±50%", color: "border-indigo-500/40 bg-indigo-500/8 text-indigo-300" },
    { value: "aggressive",   label: "Aggressive",   desc: "±90%", color: "border-amber-500/40 bg-amber-500/8 text-amber-300" },
  ]

  return (
    <div className="space-y-4">
      {/* Aggressiveness */}
      <div>
        <label className="text-[11px] text-[#71717A] uppercase tracking-wider font-medium block mb-2">
          Exploration aggressiveness
        </label>
        <div className="grid grid-cols-3 gap-2">
          {LEVELS.map(l => (
            <button
              key={l.value}
              onClick={() => setAggressiveness(l.value)}
              className={`px-2.5 py-2 rounded-lg border text-left text-xs transition-all ${
                aggressiveness === l.value ? l.color : "border-white/8 bg-white/3 text-[#71717A] hover:border-white/15"
              }`}
            >
              <div className="font-semibold">{l.label}</div>
              <div className="text-[10px] opacity-70 mt-0.5">{l.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Floor / ceiling */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-[#71717A] uppercase tracking-wider font-medium block mb-1.5">
            Price floor ($)
          </label>
          <input
            type="number"
            value={floorDollars}
            onChange={e => setFloorDollars(e.target.value)}
            placeholder={`${((plan.price_monthly as number) / 100 * 0.5).toFixed(0)} (auto)`}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-[#3F3F46] focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <div>
          <label className="text-[11px] text-[#71717A] uppercase tracking-wider font-medium block mb-1.5">
            Price ceiling ($)
          </label>
          <input
            type="number"
            value={ceilDollars}
            onChange={e => setCeilDollars(e.target.value)}
            placeholder={`${((plan.price_monthly as number) / 100 * 2).toFixed(0)} (auto)`}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-[#3F3F46] focus:outline-none focus:border-indigo-500/50"
          />
        </div>
      </div>

      {/* Save + danger zone */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        <button
          onClick={handleFreeze}
          disabled={freezing}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-amber-500/10 text-[#71717A] hover:text-amber-400 border border-white/8 hover:border-amber-500/30 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
          title="Pause exploration — only anchor price served"
        >
          <Pause className="w-3.5 h-3.5" />
          {freezing ? "…" : "Freeze"}
        </button>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-red-500/10 text-[#71717A] hover:text-red-400 border border-white/8 hover:border-red-500/30 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
          title="Delete all candidates and reset posteriors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {resetting ? "…" : "Reset"}
        </button>
      </div>
    </div>
  )
}

// ─── AI Timeline ─────────────────────────────────────────────────────────────

function AITimeline({ runs }: { runs: ScientistRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="text-xs text-[#3F3F46] text-center py-8">
        No scientist runs yet — engine activates when ≥20 new impressions accumulate
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {runs.slice(0, 8).map((run, i) => {
        const actions = (run.actions as Array<{ action: string; price_cents: number; reason?: string }>) ?? []
        const adds = actions.filter(a => a.action === "add")
        const prunes = actions.filter(a => a.action === "prune")

        return (
          <div key={run.id} className="relative pl-5">
            {/* Timeline line */}
            {i < runs.length - 1 && (
              <div className="absolute left-1.5 top-5 bottom-0 w-px bg-white/6" />
            )}
            {/* Dot */}
            <div className={`absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 ${
              run.engine === "claude"
                ? "border-violet-500 bg-violet-900"
                : "border-cyan-500 bg-cyan-900"
            }`} />

            <div className="bg-white/3 border border-white/6 rounded-xl px-3.5 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-[11px] font-semibold ${engineColor(run.engine)}`}>
                  {engineLabel(run.engine)}
                </span>
                <span className="text-[10px] text-[#52525B] bg-white/5 px-1.5 py-0.5 rounded-full capitalize">
                  {run.run_type.replace("_", " ")}
                </span>
                {run.data_maturity !== null && (
                  <span className="text-[10px] text-[#52525B]">
                    maturity {Math.round(run.data_maturity * 100)}%
                  </span>
                )}
                <span className="ml-auto text-[10px] text-[#3F3F46]">{timeAgo(run.created_at)}</span>
              </div>

              {run.reasoning && (
                <p className="text-[11px] text-[#A1A1AA] leading-relaxed mb-2 line-clamp-2">
                  {run.reasoning}
                </p>
              )}

              {(adds.length > 0 || prunes.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {adds.map((a, j) => (
                    <span key={j} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">
                      <ArrowUpRight className="w-2.5 h-2.5" /> +{fmt(a.price_cents)}
                    </span>
                  ))}
                  {prunes.map((a, j) => (
                    <span key={j} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full">
                      <Minus className="w-2.5 h-2.5" /> −{fmt(a.price_cents)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Plan Card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  planData,
  onUpdate,
}: {
  plan: Record<string, unknown>
  planData: PlanData
  onUpdate: () => void
}) {
  const [tab, setTab] = useState<"curve" | "ab" | "variable" | "revenue" | "controls">("ab")
  const [expanded, setExpanded] = useState(true)

  const anchorCents = plan.price_monthly as number
  const isEnabled = plan.dynamic_pricing_enabled as boolean
  const maturityScore = planData.maturity?.maturity_score ?? 0
  const hasEnoughData = (planData.maturity?.total_impressions ?? 0) >= 30
  const aggressiveness = (plan.pricing_aggressiveness as string) ?? "balanced"

  const aggrColors: Record<string, string> = {
    conservative: "bg-cyan-400/15 text-cyan-400",
    balanced:     "bg-indigo-400/15 text-indigo-400",
    aggressive:   "bg-amber-400/15 text-amber-400",
  }

  const TABS = [
    { key: "ab",       label: "A/B Test",  icon: BarChart3 },
    { key: "curve",    label: "Demand",    icon: TrendingUp },
    { key: "variable", label: "Signal",    icon: Target },
    { key: "revenue",  label: "Lift",      icon: ArrowUpRight },
    { key: "controls", label: "Settings",  icon: Settings2 },
  ] as const

  return (
    <div className={`bg-[#0F0F12] border rounded-2xl overflow-hidden transition-all ${
      isEnabled ? "border-indigo-500/20" : "border-white/6"
    }`}>
      {/* Card header */}
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer select-none hover:bg-white/2 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isEnabled ? "bg-indigo-600/20" : "bg-white/5"}`}>
          <Brain className={`w-4 h-4 ${isEnabled ? "text-indigo-400" : "text-[#52525B]"}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white truncate">{plan.name as string}</span>
            {isEnabled && <PulseDot active />}
            {!isEnabled && <span className="text-[10px] text-[#52525B] bg-white/5 px-1.5 py-0.5 rounded-full">paused</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-[#71717A] font-mono">{fmt(anchorCents)}/mo anchor</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold capitalize ${aggrColors[aggressiveness] ?? aggrColors.balanced}`}>
              {aggressiveness}
            </span>
          </div>
        </div>

        {/* Stats strip */}
        <div className="hidden md:flex items-center gap-4 mr-2">
          <div className="text-right">
            <div className="text-[10px] text-[#52525B] mb-0.5">Impressions</div>
            <div className="text-xs font-semibold text-white tabular-nums">
              {(planData.maturity?.total_impressions ?? 0).toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-[#52525B] mb-0.5">Candidates</div>
            <div className="text-xs font-semibold text-white tabular-nums">
              {planData.candidates.filter(c => c.is_active).length}
            </div>
          </div>
          {planData.incrementalRevenueCents !== null && Math.abs(planData.incrementalRevenueCents) >= 1 && (
            <div className="text-right">
              <div className="text-[10px] text-[#52525B] mb-0.5">Revenue lift</div>
              <div className={`text-xs font-semibold tabular-nums ${planData.incrementalRevenueCents >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {planData.incrementalRevenueCents >= 0 ? "+" : ""}{fmt(planData.incrementalRevenueCents)}
              </div>
            </div>
          )}
          {/* Data maturity */}
          <div className="w-20">
            <div className="text-[10px] text-[#52525B] mb-1">Data quality</div>
            <MaturityBar score={maturityScore} />
          </div>
        </div>

        {expanded ? <ChevronUp className="w-4 h-4 text-[#52525B] flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-[#52525B] flex-shrink-0" />}
      </div>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/6">
              {/* Tab bar */}
              <div className="flex px-4 pt-3 pb-0 gap-0.5 overflow-x-auto">
                {TABS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-all whitespace-nowrap ${
                      tab === t.key
                        ? "text-white bg-white/6 border border-b-0 border-white/8"
                        : "text-[#71717A] hover:text-[#A1A1AA]"
                    }`}
                  >
                    <t.icon className="w-3 h-3" />
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="px-5 py-4 bg-[#0A0A0D] border-t border-white/6 min-h-[180px]">
                {tab === "ab"       && <ABTestPanel candidates={planData.candidates} anchorCents={anchorCents} />}
                {tab === "curve"    && <DemandCurvePanel elasticity={planData.latestElasticity} anchorCents={anchorCents} />}
                {tab === "variable" && <VariableParfaitePanel vi={planData.variableImportance} />}
                {tab === "revenue"  && <IncrementalRevenuePanel data={planData} anchorCents={anchorCents} />}
                {tab === "controls" && <FounderControlsPanel plan={plan} planData={planData} onUpdate={onUpdate} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PricingClient({
  plans,
  accountId,
  planData,
}: {
  plans: Record<string, unknown>[]
  accountId: string
  planData: Record<string, unknown>
}) {
  const router = useRouter()

  const handleUpdate = useCallback(() => {
    router.refresh()
  }, [router])

  const activePlans = plans.filter(p => p.dynamic_pricing_enabled)
  const allRuns = plans.flatMap(p => {
    const pd = planData[p.id as string] as PlanData | undefined
    return pd?.scientistRuns ?? []
  }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const lastAdjustment = allRuns[0]?.created_at ?? null
  const totalIncremental = plans.reduce((s, p) => {
    const pd = planData[p.id as string] as PlanData | undefined
    return s + (pd?.incrementalRevenueCents ?? 0)
  }, 0)
  const totalImpressions = plans.reduce((s, p) => {
    const pd = planData[p.id as string] as PlanData | undefined
    return s + (pd?.totalImpressions ?? 0)
  }, 0)

  // Resolve plans for science timeline
  const planNames = Object.fromEntries(plans.map(p => [p.id as string, p.name as string]))

  if (plans.length === 0) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">Dynamic Pricing</h1>
          <p className="text-sm text-[#71717A]">AI-powered revenue maximisation</p>
        </div>
        <div className="border border-dashed border-white/10 rounded-2xl p-12 text-center">
          <Brain className="w-8 h-8 text-[#3F3F46] mx-auto mb-4" />
          <p className="text-[#71717A] mb-2">No plans yet</p>
          <p className="text-xs text-[#52525B]">Create a plan with dynamic pricing enabled to get started.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <TrendingUp className="w-5 h-5 text-indigo-400" />
            <h1 className="font-heading text-2xl font-semibold text-white">Dynamic Pricing</h1>
          </div>
          <p className="text-sm text-[#71717A]">
            Bayesian revenue engine — Thompson sampling + demand model
          </p>
        </div>
      </div>

      {/* ── C.1 Hero strip ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {/* Engine status */}
        <div className="bg-[#111114] border border-white/6 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3.5 h-3.5 text-[#52525B]" />
            <span className="text-[11px] text-[#52525B] uppercase tracking-wider font-medium">Engine</span>
          </div>
          <div className="flex items-center gap-2">
            <PulseDot active={activePlans.length > 0} />
            <span className={`text-sm font-semibold ${activePlans.length > 0 ? "text-white" : "text-[#52525B]"}`}>
              {activePlans.length > 0 ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="text-[11px] text-[#71717A] mt-1">
            {activePlans.length} plan{activePlans.length !== 1 ? "s" : ""} testing
          </p>
        </div>

        {/* Last adjustment */}
        <div className="bg-[#111114] border border-white/6 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-[#52525B]" />
            <span className="text-[11px] text-[#52525B] uppercase tracking-wider font-medium">Last run</span>
          </div>
          <div className="text-sm font-semibold text-white">
            {lastAdjustment ? timeAgo(lastAdjustment) : "—"}
          </div>
          <p className="text-[11px] text-[#71717A] mt-1">
            {allRuns.length} total scientist runs
          </p>
        </div>

        {/* Total impressions */}
        <div className="bg-[#111114] border border-white/6 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-3.5 h-3.5 text-[#52525B]" />
            <span className="text-[11px] text-[#52525B] uppercase tracking-wider font-medium">Impressions</span>
          </div>
          <div className="text-sm font-semibold text-white tabular-nums">
            {totalImpressions.toLocaleString()}
          </div>
          <p className="text-[11px] text-[#71717A] mt-1">Across all plans</p>
        </div>

        {/* Revenue lift */}
        <div className={`border rounded-xl p-4 ${
          totalIncremental > 0
            ? "bg-emerald-500/5 border-emerald-500/20"
            : totalIncremental < 0
              ? "bg-red-500/5 border-red-500/20"
              : "bg-[#111114] border-white/6"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className={`w-3.5 h-3.5 ${totalIncremental >= 0 ? "text-emerald-400" : "text-red-400"}`} />
            <span className="text-[11px] text-[#52525B] uppercase tracking-wider font-medium">Revenue lift</span>
          </div>
          <div className={`text-sm font-semibold tabular-nums ${totalIncremental >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {totalIncremental !== 0 ? (totalIncremental > 0 ? "+" : "") + fmt(totalIncremental) : "—"}
          </div>
          <p className="text-[11px] text-[#71717A] mt-1">vs all-anchor baseline</p>
        </div>
      </div>

      {/* ── Main layout: plan cards + timeline ──────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        {/* Left: plan cards */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#A1A1AA] uppercase tracking-wider">
              Plans ({plans.length})
            </h2>
            {activePlans.length < plans.length && (
              <span className="text-xs text-[#52525B]">
                {plans.length - activePlans.length} plan{plans.length - activePlans.length !== 1 ? "s" : ""} with dynamic pricing off
              </span>
            )}
          </div>

          {plans.map(plan => {
            const pd = planData[plan.id as string] as PlanData | undefined
            if (!pd) return null
            return (
              <PlanCard
                key={plan.id as string}
                plan={plan}
                planData={pd}
                onUpdate={handleUpdate}
              />
            )
          })}
        </div>

        {/* Right: AI decision timeline */}
        <div className="xl:sticky xl:top-6 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <div className="bg-[#0F0F12] border border-white/6 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-4 h-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-white">AI Decision Timeline</h2>
              <span className="ml-auto text-[10px] text-[#52525B]">{allRuns.length} runs</span>
            </div>

            {/* Runs labelled by plan */}
            {allRuns.length === 0 ? (
              <div className="text-xs text-[#3F3F46] text-center py-8 leading-relaxed">
                No scientist runs yet.<br />
                Engine triggers when a plan accumulates ≥20 new impressions since the last run.
              </div>
            ) : (
              <div className="space-y-3">
                {allRuns.slice(0, 12).map((run, i) => {
                  const actions = (run.actions as Array<{ action: string; price_cents: number }>) ?? []
                  const adds = actions.filter(a => a.action === "add")
                  const prunes = actions.filter(a => a.action === "prune")

                  return (
                    <div key={run.id} className="relative pl-5">
                      {i < Math.min(allRuns.length - 1, 11) && (
                        <div className="absolute left-1.5 top-5 bottom-0 w-px bg-white/5" />
                      )}
                      <div className={`absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 ${
                        run.engine === "claude" ? "border-violet-500 bg-[#0D0D0F]" : "border-cyan-500 bg-[#0D0D0F]"
                      }`} />

                      <div className="bg-white/2 border border-white/5 rounded-xl px-3 py-2.5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`text-[10px] font-semibold ${engineColor(run.engine)}`}>
                            {engineLabel(run.engine)}
                          </span>
                          <span className="text-[10px] text-[#52525B] truncate max-w-[80px]">
                            {planNames[run.plan_id] ?? ""}
                          </span>
                          <span className="ml-auto text-[10px] text-[#3F3F46]">{timeAgo(run.created_at)}</span>
                        </div>
                        {run.reasoning && (
                          <p className="text-[11px] text-[#71717A] line-clamp-2 leading-relaxed mb-1.5">
                            {run.reasoning}
                          </p>
                        )}
                        {(adds.length > 0 || prunes.length > 0) && (
                          <div className="flex flex-wrap gap-1">
                            {adds.map((a, j) => (
                              <span key={j} className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">
                                +{fmt(a.price_cents)}
                              </span>
                            ))}
                            {prunes.map((a, j) => (
                              <span key={j} className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full">
                                −{fmt(a.price_cents)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

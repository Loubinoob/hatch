"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  TrendingUp, Brain, Activity, Pause, RotateCcw,
  Layers, Clock, ArrowUpRight, ArrowDownRight, ChevronDown,
  ChevronUp, Loader2, Zap, AlertCircle, Play, Network
} from "lucide-react"
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts"
import { toast } from "sonner"

import { formatPrice, revenuePerImpression } from "@/lib/price-ladder"
import { evaluateDemandCurve, FEATURE_NAMES, N_FEATURES } from "@/lib/demand-model"
import type { DemandModelState } from "@/lib/demand-model"
import type { SegmentInput } from "@/lib/segment"
import type { PricingAggressiveness } from "@/lib/price-ladder"
import { format } from "date-fns"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Candidate {
  id: string
  plan_id: string
  price_cents: number
  is_anchor: boolean
  is_active: boolean
  impressions: number
  conversions: number
  revenue_cents: number
  rpi: number
}

interface PlanData {
  candidates: Candidate[]
  latestElasticity: {
    plan_id: string
    curve: { price_cents: number; impressions: number; conversions: number; conv_rate: number; rpi_cents: number; ci_low: number; ci_high: number }[]
    optimal_price_cents: number | null
    confidence: number
    computed_at: string
  } | null
  variableImportance: {
    variable_name: string
    importance_score: number
    optimal_price_by_value: Record<string, number>
    revenue_spread_cents: number
  }[]
  scientistRuns: {
    id: string
    plan_id: string
    run_type: string
    engine: string
    reasoning: string | null
    actions: unknown[]
    data_maturity: number
    duration_ms: number
    created_at: string
    model_used: string | null
    optimal_by_segment?: Record<string, number> | null
  }[]
  maturity: {
    total_impressions: number
    total_conversions: number
    maturity_score: number
    preferred_engine: string
  } | null
  demandModel: {
    plan_id: string
    n_obs: number
    anchor_cents: number
    feature_names: string[] | null
    m_vec: number[] | null
    q_vec: number[] | null
  } | null
  totalImpressions: number
  totalRevenueCents: number
  incrementalRevenueCents: number | null
  anchorConvRate: number | null
  optimalBySegment: Record<string, number> | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

function fmtPct(n: number) { return `${n.toFixed(1)}%` }

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatMoney(cents: number) {
  if (cents === 0) return "$0"
  if (cents < 100) return `${cents}¢`
  return `$${(cents / 100).toFixed(2)}`
}

function toDemandModelState(row: PlanData["demandModel"], anchorCents: number): DemandModelState | null {
  if (!row || !row.m_vec || row.m_vec.length !== N_FEATURES) return null
  return {
    n_obs:         row.n_obs,
    anchor_cents:  row.anchor_cents ?? anchorCents,
    feature_names: row.feature_names ?? FEATURE_NAMES,
    m:             row.m_vec,
    q:             row.q_vec ?? new Array(N_FEATURES).fill(1),
  }
}

// ─── PulseDot ─────────────────────────────────────────────────────────────────

function PulseDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${active ? "bg-emerald-400" : "bg-[#52525B]"}`} />
    </span>
  )
}

// ─── Per-plan card ─────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  data,
  onRunNow,
  runningOptimization,
  onUpdate,
}: {
  plan: Record<string, unknown>
  data: PlanData
  onRunNow: (planId: string) => void
  runningOptimization: string | null
  onUpdate: () => void
}) {
  const [controlsOpen, setControlsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [narrowing, setNarrowing] = useState(false)

  const planId       = plan.id as string
  const anchorCents  = plan.price_monthly as number
  const isEnabled    = plan.dynamic_pricing_enabled as boolean
  const isFrozen     = (plan.pricing_frozen as boolean) ?? false
  const aggressiveness = (plan.pricing_aggressiveness as string) ?? "balanced"
  const maturityPct  = data.maturity ? Math.round(data.maturity.maturity_score * 100) : 0
  const isRunning    = runningOptimization === planId

  // Active candidates sorted by price
  const activeCandidates = data.candidates.filter(c => c.is_active)
  const maxRpi = Math.max(...activeCandidates.map(c => c.rpi), 0.001)
  const winner = activeCandidates.length > 0
    ? activeCandidates.reduce((a, b) => a.rpi >= b.rpi ? a : b, activeCandidates[0])
    : null

  // Demand model state
  const demandModelState = toDemandModelState(data.demandModel, anchorCents)
  const priceLadder = activeCandidates.map(c => c.price_cents)
  const neutralSeg: SegmentInput = {
    quiz_answers: {}, utm_source: null, device: "desktop", returning: false, hour_bucket: "morning",
  }
  const demandCurvePoints = demandModelState && demandModelState.n_obs > 0 && priceLadder.length > 1
    ? evaluateDemandCurve(demandModelState, priceLadder, neutralSeg)
    : null

  // Elasticity label from price_norm coefficient
  const priceCoeff = demandModelState ? demandModelState.m[1] : null
  const elasticityLabel = priceCoeff === null ? null
    : priceCoeff < -2   ? { text: "Highly elastic",        color: "text-red-400" }
    : priceCoeff < -0.5 ? { text: "Price-sensitive",       color: "text-amber-400" }
    : priceCoeff < 0.2  ? { text: "Moderate elasticity",   color: "text-blue-400" }
    :                     { text: "Inelastic / prestige",  color: "text-emerald-400" }

  // Aggressiveness badge colours
  const aggrColor: Record<string, string> = {
    conservative: "bg-cyan-400/15 text-cyan-400",
    balanced:     "bg-indigo-400/15 text-indigo-400",
    aggressive:   "bg-amber-400/15 text-amber-400",
  }

  // Founder controls state
  const [aggr, setAggr] = useState<PricingAggressiveness>(aggressiveness as PricingAggressiveness)
  const [floorVal, setFloorVal] = useState(
    plan.price_floor_cents ? String((plan.price_floor_cents as number) / 100) : ""
  )
  const [ceilVal, setCeilVal] = useState(
    plan.price_ceiling_cents ? String((plan.price_ceiling_cents as number) / 100) : ""
  )

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/pricing/save-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planId,
          pricing_aggressiveness: aggr,
          price_floor_cents:  floorVal ? Math.round(parseFloat(floorVal) * 100) : null,
          price_ceiling_cents: ceilVal ? Math.round(parseFloat(ceilVal) * 100) : null,
        }),
      })
      const d = await res.json()
      if (res.ok) { toast.success("Settings saved"); onUpdate() }
      else toast.error(d.error ?? "Save failed")
    } catch {
      toast.error("Network error")
    } finally {
      setSaving(false)
    }
  }

  async function handleFreeze() {
    const willFreeze = !isFrozen
    if (willFreeze && !confirm("Freeze exploration? Only the anchor price will be served until you unfreeze.")) return
    setFreezing(true)
    try {
      const res = await fetch("/api/pricing/freeze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId, freeze: willFreeze }),
      })
      const d = await res.json()
      if (res.ok) {
        toast.success(willFreeze
          ? `Frozen — ${d.deactivated} candidates paused`
          : `Unfrozen — ${d.reactivated} candidates active`)
        onUpdate()
      } else toast.error("Freeze toggle failed")
    } catch {
      toast.error("Network error")
    } finally {
      setFreezing(false)
    }
  }

  async function handleNarrowWindow() {
    setNarrowing(true)
    try {
      const res = await fetch("/api/pricing/regenerate-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      })
      const d = await res.json()
      if (res.ok) {
        toast.success(`Window narrowed — ${d.results?.[0]?.deactivated ?? 0} wide candidates deactivated, ${d.results?.[0]?.added ?? 0} ±1-step candidates added`)
        onUpdate()
      } else toast.error(d.error ?? "Narrow window failed")
    } catch {
      toast.error("Network error")
    } finally {
      setNarrowing(false)
    }
  }

  async function handleReset() {
    if (!confirm("Reset all pricing data? Deletes non-anchor candidates, wipes the Bayesian model, and regenerates fresh candidates.")) return
    setResetting(true)
    try {
      const res = await fetch("/api/pricing/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      })
      const d = await res.json()
      if (res.ok) { toast.success(`Pricing reset — ${d.regenerated ? "fresh candidates regenerated" : "done"}`); onUpdate() }
      else toast.error(d.error ?? "Reset failed")
    } catch {
      toast.error("Network error")
    } finally {
      setResetting(false)
    }
  }

  const AGGR_LEVELS: { value: PricingAggressiveness; label: string; desc: string; cls: string }[] = [
    { value: "conservative", label: "Conservative", desc: "±1 step — no hill-climbing", cls: "border-cyan-500/40 bg-cyan-500/8 text-cyan-300" },
    { value: "balanced",     label: "Balanced",     desc: "±1 step, expands at maturity", cls: "border-indigo-500/40 bg-indigo-500/8 text-indigo-300" },
    { value: "aggressive",   label: "Aggressive",   desc: "±1 step, fast hill-climbing", cls: "border-amber-500/40 bg-amber-500/8 text-amber-300" },
  ]

  return (
    <div className={`bg-[#0F0F12] border rounded-2xl overflow-hidden ${isEnabled ? "border-indigo-500/20" : "border-white/6"}`}>

      {/* ── Card header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isEnabled ? "bg-indigo-600/20" : "bg-white/5"}`}>
          <Brain className={`w-4 h-4 ${isEnabled ? "text-indigo-400" : "text-[#52525B]"}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white truncate">{plan.name as string}</span>
            <PulseDot active={isEnabled} />
            {!isEnabled && (
              <span className="text-[10px] text-[#52525B] bg-white/5 px-1.5 py-0.5 rounded-full">paused</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-[#71717A] font-mono">{fmt(anchorCents)}/mo anchor</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold capitalize ${aggrColor[aggressiveness] ?? aggrColor.balanced}`}>
              {aggressiveness}
            </span>
            {elasticityLabel && demandModelState && (
              <span className={`text-[10px] ${elasticityLabel.color}`}>
                {elasticityLabel.text} (ε={priceCoeff?.toFixed(2)}, {demandModelState.n_obs} obs)
              </span>
            )}
          </div>
        </div>

        {/* Stats: maturity + best price */}
        <div className="hidden sm:flex items-center gap-4 mr-2">
          {data.maturity && (
            <div className="text-right">
              <div className="text-[10px] text-[#52525B] mb-1">
                {data.maturity.preferred_engine === "in_house_model" ? "Model-driven" : "Claude-driven"}
                {" · "}{maturityPct}% mature
              </div>
              <div className="w-24 h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${data.maturity.preferred_engine === "in_house_model" ? "bg-purple-500" : "bg-indigo-500"}`}
                  style={{ width: `${maturityPct}%` }}
                />
              </div>
            </div>
          )}
          {winner && activeCandidates.some(c => c.impressions > 0) && (
            <div className="text-right">
              <p className="text-[10px] text-[#52525B]">Best price</p>
              <p className="text-sm font-mono font-semibold text-emerald-400">{formatPrice(winner.price_cents)}</p>
            </div>
          )}
          {data.incrementalRevenueCents !== null && data.totalImpressions >= 30 && (
            <div className="text-right">
              <p className="text-[10px] text-[#52525B]">Revenue lift</p>
              <p className={`text-sm font-mono font-semibold tabular-nums ${data.incrementalRevenueCents >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {data.incrementalRevenueCents >= 0 ? "+" : ""}{fmt(data.incrementalRevenueCents)}
              </p>
            </div>
          )}
        </div>

        {/* Run now button */}
        <button
          onClick={() => onRunNow(planId)}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 text-indigo-300 text-xs font-semibold rounded-lg transition-all disabled:opacity-50 shrink-0"
          title="Trigger AI optimization run now"
        >
          {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {isRunning ? "Running…" : "Run now"}
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="border-t border-white/6 px-5 py-4 bg-[#0A0A0D] space-y-5">

        {activeCandidates.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-xs text-[#3F3F46]">
            <Zap className="w-3.5 h-3.5" />
            No active candidates — will bootstrap on first paywall impression
          </div>
        ) : (
          <>
            {/* ── RPI chart ─────────────────────────────────────────────────── */}
            <div>
              <p className="text-[10px] text-[#52525B] mb-2 uppercase tracking-wider font-medium">
                Revenue per impression by price point
              </p>
              <ResponsiveContainer width="100%" height={110}>
                <LineChart
                  data={activeCandidates.map(c => ({
                    price:       formatPrice(c.price_cents),
                    rpi:         c.rpi,
                    impressions: c.impressions,
                  }))}
                  margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                >
                  <XAxis dataKey="price" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => formatMoney(Number(v))} tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: unknown, name: unknown) => [
                      name === "rpi" ? formatMoney(Number(v)) : String(v),
                      name === "rpi" ? "Rev/impression" : "Impressions",
                    ]}
                  />
                  <Line type="monotone" dataKey="rpi" stroke="#6366F1" strokeWidth={2} dot={{ fill: "#6366F1", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* ── Candidates table ──────────────────────────────────────────── */}
            <div className="space-y-1.5">
              {activeCandidates.map(c => {
                const isWinner = winner && c.id === winner.id && c.impressions > 10
                const cr = c.impressions > 0 ? (c.conversions / c.impressions) * 100 : null
                return (
                  <div key={c.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                    isWinner ? "bg-emerald-500/5 border border-emerald-500/15" : "bg-white/2"
                  }`}>
                    <span className="font-mono text-sm text-white w-12 shrink-0">{formatPrice(c.price_cents)}</span>
                    <div className="flex items-center gap-1.5 w-20 shrink-0">
                      {c.is_anchor && (
                        <span className="text-[9px] bg-white/8 text-[#71717A] px-1.5 py-0.5 rounded">anchor</span>
                      )}
                      {isWinner && (
                        <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded">best</span>
                      )}
                    </div>
                    <div className="flex-1 grid grid-cols-3 gap-2 text-[11px] text-[#71717A]">
                      <span>{c.impressions.toLocaleString()} imp.</span>
                      <span>{cr !== null ? `${cr.toFixed(1)}%` : "—"} conv</span>
                      <span className="text-white">{c.rpi > 0 ? `${formatMoney(c.rpi)}/imp` : "—"}</span>
                    </div>
                    <div className="w-20 h-1 bg-white/5 rounded-full overflow-hidden shrink-0">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(c.rpi / maxRpi) * 100}%` }}
                        transition={{ duration: 0.6 }}
                        className={`h-full rounded-full ${isWinner ? "bg-emerald-400" : "bg-indigo-500"}`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── Demand curve (Bayesian model) ─────────────────────────────────── */}
        {demandCurvePoints && demandCurvePoints.length >= 2 && (
          <div className="border-t border-white/6 pt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wider">
                Demand curve — P(convert) vs price
              </p>
              <span className="text-[9px] text-[#52525B]">
                Chapelle-Li model · {demandModelState?.n_obs} obs · 95% CI
              </span>
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart
                data={demandCurvePoints.map(pt => ({
                  price:      formatPrice(pt.price_cents),
                  conv:       Math.round(pt.conv_prob * 1000) / 10,
                  conv_low:   Math.round(pt.conv_low  * 1000) / 10,
                  conv_high:  Math.round(pt.conv_high * 1000) / 10,
                }))}
                margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
              >
                <XAxis dataKey="price" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `${v}%`} tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 11 }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any, name: any) => {
                    const n = typeof v === "number" ? v : 0
                    if (name === "conv")      return [`${n.toFixed(1)}%`, "Conv. prob (mean)"]
                    if (name === "conv_high") return [`${n.toFixed(1)}%`, "CI high"]
                    if (name === "conv_low")  return [`${n.toFixed(1)}%`, "CI low"]
                    return [v, name]
                  }}
                />
                <Area type="monotone" dataKey="conv_high" stroke="none" fill="#6366F1" fillOpacity={0.12} legendType="none" />
                <Area type="monotone" dataKey="conv_low"  stroke="none" fill="#0A0A0D" fillOpacity={1}    legendType="none" />
                <Area type="monotone" dataKey="conv" stroke="#6366F1" strokeWidth={2} fill="#6366F1" fillOpacity={0.05}
                  dot={{ fill: "#6366F1", r: 3 }} />
                {demandModelState && (
                  <ReferenceLine
                    x={formatPrice(demandModelState.anchor_cents)}
                    stroke="#F59E0B" strokeDasharray="4 3"
                    label={{ value: "anchor", fill: "#F59E0B", fontSize: 9, position: "top" }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-[#52525B] mt-1">
              Shaded band = 95% predictive interval. Dashed = anchor.
              {winner && activeCandidates.some(c => c.impressions > 0) && ` RPI optimal: ${formatPrice(winner.price_cents)}`}
            </p>
          </div>
        )}

        {/* ── Optimal by segment ───────────────────────────────────────────── */}
        {data.optimalBySegment && Object.keys(data.optimalBySegment).length > 1 && (
          <div className="border-t border-white/6 pt-4">
            <p className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wider mb-3">
              Optimal price by segment
            </p>
            <div className="space-y-1.5">
              {Object.entries(data.optimalBySegment)
                .sort(([a], [b]) => a === "global" ? -1 : b === "global" ? 1 : 0)
                .slice(0, 8)
                .map(([seg, priceCents]) => {
                  const maxP = Math.max(...Object.values(data.optimalBySegment!) as number[], 1)
                  return (
                    <div key={seg} className="flex items-center gap-3">
                      <span className="text-[10px] text-[#71717A] w-36 truncate">
                        {seg === "global" ? "🌐 global" : seg}
                      </span>
                      <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full"
                          style={{ width: `${((priceCents as number) / maxP) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-white w-10 text-right">
                        {formatPrice(priceCents as number)}
                      </span>
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {/* ── Variable importance ───────────────────────────────────────────── */}
        {data.variableImportance.length > 0 && (
          <div className="border-t border-white/6 pt-4">
            <p className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wider mb-3">
              Pricing variables — what drives WTP
            </p>
            <div className="space-y-3">
              {data.variableImportance.slice(0, 3).map(v => {
                const maxOptimal = Math.max(...Object.values(v.optimal_price_by_value), 1)
                return (
                  <div key={v.variable_name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-white">{v.variable_name}</span>
                      <span className="text-[10px] text-[#52525B]">
                        {Math.round(v.importance_score * 100)}% importance · spread {formatPrice(v.revenue_spread_cents)}/imp
                      </span>
                    </div>
                    <div className="space-y-1">
                      {Object.entries(v.optimal_price_by_value).slice(0, 4).map(([val, priceCents]) => (
                        <div key={val} className="flex items-center gap-2">
                          <span className="text-[10px] text-[#71717A] w-20 truncate">{val}</span>
                          <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-violet-500 rounded-full"
                              style={{ width: `${(priceCents / maxOptimal) * 100}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-white w-10 text-right">
                            {formatPrice(priceCents)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Recent scientist runs ─────────────────────────────────────────── */}
        {data.scientistRuns.length > 0 && (
          <div className="border-t border-white/6 pt-4">
            <p className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wider mb-3">
              Recent AI runs
            </p>
            <div className="space-y-2">
              {data.scientistRuns.slice(0, 3).map(run => (
                <div key={run.id} className="flex gap-3 text-[11px]">
                  <div className="flex flex-col items-center shrink-0">
                    <div className={`w-2 h-2 rounded-full mt-0.5 ${
                      run.engine === "claude" ? "bg-indigo-500" : "bg-purple-500"
                    }`} />
                    <div className="flex-1 w-px bg-white/6 mt-1" />
                  </div>
                  <div className="pb-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                        run.engine === "claude" ? "bg-indigo-500/15 text-indigo-400" : "bg-purple-500/15 text-purple-400"
                      }`}>{run.engine}</span>
                      <span className="text-[#52525B]">{run.run_type}</span>
                      <span className="text-[#52525B]">·</span>
                      <span className="text-[#52525B]">{Math.round((run.data_maturity ?? 0) * 100)}% mature</span>
                      <span className="text-[#52525B] ml-auto shrink-0">
                        {format(new Date(run.created_at), "MMM d HH:mm")}
                      </span>
                    </div>
                    {run.reasoning && (
                      <p className="text-[#71717A] line-clamp-2 mb-1">{run.reasoning}</p>
                    )}
                    {Array.isArray(run.actions) && run.actions.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(run.actions as { action: string; price_cents: number }[]).slice(0, 4).map((a, i) => (
                          <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded ${
                            a.action === "add" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                          }`}>
                            {a.action} {formatPrice(a.price_cents)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Founder controls (collapsible) ────────────────────────────────── */}
        <div className="border-t border-white/6 pt-3">
          <button
            onClick={() => setControlsOpen(o => !o)}
            className="flex items-center gap-2 text-[11px] text-[#52525B] hover:text-[#A1A1AA] transition-colors w-full"
          >
            {controlsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Founder controls
          </button>

          <AnimatePresence initial={false}>
            {controlsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="pt-3 space-y-4">
                  {/* Aggressiveness */}
                  <div>
                    <label className="text-[11px] text-[#71717A] uppercase tracking-wider font-medium block mb-2">
                      Exploration aggressiveness
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {AGGR_LEVELS.map(l => (
                        <button key={l.value} type="button" onClick={() => setAggr(l.value)}
                          className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-all ${
                            aggr === l.value ? l.cls : "border-white/8 bg-white/3 text-[#71717A] hover:border-white/15"
                          }`}>
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
                        Floor ($)
                      </label>
                      <input type="number" value={floorVal} onChange={e => setFloorVal(e.target.value)}
                        placeholder={`${(anchorCents / 100 * 0.5).toFixed(0)} auto`}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-[#3F3F46] focus:outline-none focus:border-indigo-500/50" />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#71717A] uppercase tracking-wider font-medium block mb-1.5">
                        Ceiling ($)
                      </label>
                      <input type="number" value={ceilVal} onChange={e => setCeilVal(e.target.value)}
                        placeholder={`${(anchorCents / 100 * 2).toFixed(0)} auto`}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-[#3F3F46] focus:outline-none focus:border-indigo-500/50" />
                    </div>
                  </div>

                  {/* Save + danger zone */}
                  <div className="flex items-center gap-2">
                    <button onClick={handleSave} disabled={saving}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
                      {saving ? "Saving…" : "Save settings"}
                    </button>
                    <button onClick={handleFreeze} disabled={freezing}
                      className={`flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all disabled:opacity-50 ${
                        isFrozen
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25"
                          : "bg-white/5 border-white/8 text-[#71717A] hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30"
                      }`}
                      title={isFrozen ? "Unfreeze — resume dynamic pricing" : "Freeze — lock prices, stop exploration"}>
                      <Pause className="w-3.5 h-3.5" />
                      {freezing ? "…" : isFrozen ? "Frozen" : "Freeze"}
                    </button>
                    <button onClick={handleReset} disabled={resetting}
                      className="flex items-center gap-1 px-3 py-2 bg-white/5 hover:bg-red-500/10 text-[#71717A] hover:text-red-400 border border-white/8 hover:border-red-500/30 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
                      title="Delete all candidates and reset posteriors">
                      <RotateCcw className="w-3.5 h-3.5" />
                      {resetting ? "…" : "Reset"}
                    </button>
                  </div>
                  <div className="pt-1 border-t border-white/6">
                    <button onClick={handleNarrowWindow} disabled={narrowing}
                      className="text-[10px] text-[#52525B] hover:text-cyan-400 transition-colors disabled:opacity-50 w-full text-left"
                      title="Deactivate any candidates outside ±1 ladder step from anchor (preserves posteriors)">
                      {narrowing ? "Narrowing…" : "⟵ Narrow to ±1-step window (keeps existing data)"}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function PricingClient({
  plans,
  accountId,
  planData,
  loadError,
  paywalls,
  choiceModelData,
}: {
  plans: Record<string, unknown>[]
  accountId: string
  planData: Record<string, unknown>
  loadError?: string
  paywalls?: Array<{ id: string; name: string; plan_ids: string[] }>
  choiceModelData?: Record<string, {
    n_obs: number
    joint_rpi_cents: number
    independent_rpi_cents: number
    updated_at: string | null
  }>
}) {
  const router = useRouter()
  const [runningOptimization, setRunningOptimization] = useState<string | null>(null)

  const handleUpdate = useCallback(() => router.refresh(), [router])

  async function handleRunNow(planId: string) {
    setRunningOptimization(planId)
    try {
      const res = await fetch("/api/pricing/scientist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Optimization failed")
      const n = (data.actions_applied ?? []).length
      toast.success(
        n > 0
          ? `Optimization complete — ${n} action${n !== 1 ? "s" : ""} taken`
          : "Optimization complete — no changes needed",
        { description: data.reasoning ? data.reasoning.slice(0, 120) + (data.reasoning.length > 120 ? "…" : "") : undefined }
      )
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed")
    } finally {
      setRunningOptimization(null)
    }
  }

  // Aggregate hero stats
  const activePlans = plans.filter(p => p.dynamic_pricing_enabled)
  const allRuns = plans.flatMap(p => {
    const pd = planData[p.id as string] as PlanData | undefined
    return pd?.scientistRuns ?? []
  }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const lastAdjustment = allRuns[0]?.created_at ?? null
  const totalImpressions = plans.reduce((s, p) => {
    const pd = planData[p.id as string] as PlanData | undefined
    return s + (pd?.totalImpressions ?? 0)
  }, 0)
  const totalLift = plans.reduce((s, p) => {
    const pd = planData[p.id as string] as PlanData | undefined
    return s + (pd?.incrementalRevenueCents ?? 0)
  }, 0)

  const planNames = Object.fromEntries(plans.map(p => [p.id as string, p.name as string]))

  // ── Error state ───────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">Dynamic Pricing</h1>
        </div>
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-8 flex items-start gap-4">
          <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-300 mb-1">Could not load plans</p>
            <p className="text-xs text-red-400/80">{loadError}</p>
          </div>
        </div>
      </div>
    )
  }

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (plans.length === 0) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">Dynamic Pricing</h1>
          <p className="text-sm text-[#71717A]">AI-powered revenue optimisation</p>
        </div>
        <div className="border border-dashed border-white/10 rounded-2xl p-12 text-center">
          <Brain className="w-8 h-8 text-[#3F3F46] mx-auto mb-4" />
          <p className="text-[#71717A] mb-1">No plans yet</p>
          <p className="text-xs text-[#52525B]">Create a plan with dynamic pricing enabled to get started.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">

      {/* ── Page header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <TrendingUp className="w-5 h-5 text-indigo-400" />
            <h1 className="font-heading text-2xl font-semibold text-white">Dynamic Pricing</h1>
          </div>
          <p className="text-sm text-[#71717A]">
            Bayesian revenue engine — Thompson sampling + Chapelle-Li demand model
          </p>
        </div>
      </div>

      {/* ── Hero strip (C.1) ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
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
            {activePlans.length} of {plans.length} plan{plans.length !== 1 ? "s" : ""} live
          </p>
        </div>

        <div className="bg-[#111114] border border-white/6 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-[#52525B]" />
            <span className="text-[11px] text-[#52525B] uppercase tracking-wider font-medium">Last run</span>
          </div>
          <div className="text-sm font-semibold text-white">{lastAdjustment ? timeAgo(lastAdjustment) : "—"}</div>
          <p className="text-[11px] text-[#71717A] mt-1">{allRuns.length} total scientist runs</p>
        </div>

        <div className="bg-[#111114] border border-white/6 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-3.5 h-3.5 text-[#52525B]" />
            <span className="text-[11px] text-[#52525B] uppercase tracking-wider font-medium">Impressions</span>
          </div>
          <div className="text-sm font-semibold text-white tabular-nums">{totalImpressions.toLocaleString()}</div>
          <p className="text-[11px] text-[#71717A] mt-1">Across all plans</p>
        </div>

        <div className={`border rounded-xl p-4 ${
          totalLift > 0 ? "bg-emerald-500/5 border-emerald-500/20"
          : totalLift < 0 ? "bg-red-500/5 border-red-500/20"
          : "bg-[#111114] border-white/6"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className={`w-3.5 h-3.5 ${totalLift >= 0 ? "text-emerald-400" : "text-red-400"}`} />
            <span className="text-[11px] text-[#52525B] uppercase tracking-wider font-medium">Revenue lift</span>
          </div>
          <div className={`text-sm font-semibold tabular-nums ${totalLift >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {totalImpressions >= 30 && totalLift !== 0
              ? (totalLift > 0 ? "+" : "") + fmt(totalLift)
              : "—"}
          </div>
          <p className="text-[11px] text-[#71717A] mt-1">vs all-anchor baseline</p>
        </div>
      </div>

      {/* ── Joint Revenue Optimisation card ─────────────────────────────────────── */}
      {paywalls && paywalls.length > 0 && (
        <div className="mb-6 bg-[#0F0F12] border border-white/6 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Network className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-white">Joint Revenue Optimisation</h2>
            <span className="text-[10px] text-[#52525B] ml-auto">
              Multinomial logit — captures substitution between plans
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {paywalls.map(pw => {
              const cm = choiceModelData?.[pw.id]
              const hasData = cm && cm.n_obs >= 20
              const lift = hasData && cm.independent_rpi_cents > 0
                ? ((cm.joint_rpi_cents - cm.independent_rpi_cents) / cm.independent_rpi_cents) * 100
                : null
              return (
                <div key={pw.id} className={`rounded-xl border p-3.5 ${
                  hasData && lift !== null && lift > 0
                    ? "bg-violet-500/5 border-violet-500/20"
                    : "bg-white/2 border-white/6"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium text-[#A1A1AA] truncate">{pw.name}</span>
                    {hasData && (
                      <span className="text-[9px] bg-violet-500/15 text-violet-400 px-1.5 py-0.5 rounded-full shrink-0 ml-1">
                        {cm.n_obs} obs
                      </span>
                    )}
                  </div>
                  {!cm || cm.n_obs === 0 ? (
                    <div className="text-[11px] text-[#52525B]">No data yet — collecting cross-plan impressions</div>
                  ) : cm.n_obs < 20 ? (
                    <div>
                      <div className="text-[11px] text-[#71717A] mb-1">{cm.n_obs}/20 observations to activate</div>
                      <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full" style={{ width: `${(cm.n_obs / 20) * 100}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#71717A]">Joint RPI</span>
                        <span className="text-violet-400 font-mono font-semibold tabular-nums">
                          {formatMoney(Math.round(cm.joint_rpi_cents))}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#71717A]">Independent RPI</span>
                        <span className="text-[#A1A1AA] font-mono tabular-nums">
                          {formatMoney(Math.round(cm.independent_rpi_cents))}
                        </span>
                      </div>
                      {lift !== null && (
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-white/6">
                          <span className="text-[#71717A]">Cross-plan lift</span>
                          <span className={`font-semibold tabular-nums ${lift > 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {lift > 0 ? "+" : ""}{lift.toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Main layout ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">

        {/* Left: plan cards */}
        <div className="space-y-4">
          {plans.map(plan => {
            const pd = planData[plan.id as string] as PlanData | undefined
            if (!pd) return null
            return (
              <PlanCard
                key={plan.id as string}
                plan={plan}
                data={pd}
                onRunNow={handleRunNow}
                runningOptimization={runningOptimization}
                onUpdate={handleUpdate}
              />
            )
          })}
        </div>

        {/* Right: sticky AI timeline */}
        <div className="xl:sticky xl:top-6 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <div className="bg-[#0F0F12] border border-white/6 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-4 h-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-white">AI Decision Timeline</h2>
              <span className="ml-auto text-[10px] text-[#52525B]">{allRuns.length} runs</span>
            </div>

            {allRuns.length === 0 ? (
              <div className="text-xs text-[#3F3F46] text-center py-8 leading-relaxed">
                No runs yet. Press <span className="text-indigo-400 font-medium">Run now</span> on any plan, or wait for the next cron tick (every 4h, triggers at ≥20 new impressions).
              </div>
            ) : (
              <div className="space-y-3">
                {allRuns.slice(0, 15).map((run, i) => {
                  const actions = (run.actions as Array<{ action: string; price_cents: number }>) ?? []
                  const adds   = actions.filter(a => a.action === "add")
                  const prunes = actions.filter(a => a.action === "prune")

                  return (
                    <div key={run.id} className="relative pl-5">
                      {i < Math.min(allRuns.length - 1, 14) && (
                        <div className="absolute left-1.5 top-5 bottom-0 w-px bg-white/5" />
                      )}
                      <div className={`absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 ${
                        run.engine === "claude" ? "border-violet-500 bg-[#0D0D0F]" : "border-cyan-500 bg-[#0D0D0F]"
                      }`} />
                      <div className="bg-white/2 border border-white/5 rounded-xl px-3 py-2.5">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className={`text-[10px] font-semibold ${run.engine === "claude" ? "text-violet-400" : "text-cyan-400"}`}>
                            {run.engine === "claude" ? "Claude" : "In-house"}
                          </span>
                          <span className="text-[10px] text-[#52525B] truncate max-w-[80px]">
                            {planNames[run.plan_id] ?? ""}
                          </span>
                          <span className="ml-auto text-[10px] text-[#3F3F46] shrink-0">{timeAgo(run.created_at)}</span>
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
                                +{formatPrice(a.price_cents)}
                              </span>
                            ))}
                            {prunes.map((a, j) => (
                              <span key={j} className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full">
                                −{formatPrice(a.price_cents)}
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

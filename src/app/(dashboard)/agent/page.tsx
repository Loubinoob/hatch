"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion, AnimatePresence } from "framer-motion"
import {
  Brain, Sparkles, Activity, TrendingUp, TrendingDown, Zap,
  CheckCircle2, XCircle, Loader2, AlertTriangle, Clock, BarChart2,
  RefreshCw, ChevronRight, Eye, MousePointerClick, Shield, Info,
} from "lucide-react"
import Link from "next/link"

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentRun = {
  id: string
  paywall_id: string | null
  run_type: "generation" | "reflection" | "meta_reflection"
  status: "running" | "succeeded" | "failed"
  reasoning: string | null
  output_summary: Record<string, unknown> | null
  tokens_in: number | null
  tokens_out: number | null
  duration_ms: number | null
  created_at: string
  paywalls?: { headline: string | null } | null
}

type AgentInsight = {
  id: string
  insight: string
  category: string
  importance: number
  learning_type: string
  confirmed_count: number
  generated_at: string
  paywall_id: string | null
  paywalls?: { headline: string | null } | null
}

type Antipattern = {
  id: string
  description: string
  pattern_type: string
  confidence: number
  active: boolean
  created_at: string
}

type PaywallStat = {
  id: string
  headline: string
  status: string
  views: number
  conversions: number
  active_variants: number
}

type KPIs = {
  totalRuns: number
  successRate: number
  insightsTotal: number
  antipatternTotal: number
  tokensSpent: number
  avgDuration: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return "just now"
}

function convRate(views: number, conversions: number) {
  if (!views) return "—"
  return ((conversions / views) * 100).toFixed(1) + "%"
}

const RUN_TYPE_LABELS: Record<string, string> = {
  generation: "Generated variants",
  reflection: "Reflected on data",
  meta_reflection: "Cross-paywall analysis",
}

const RUN_TYPE_ICONS: Record<string, typeof Brain> = {
  generation: Sparkles,
  reflection: Brain,
  meta_reflection: Activity,
}

const CATEGORY_COLORS: Record<string, string> = {
  copy: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  pricing: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  timing: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  audience: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  design: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  cta: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  social_proof: "bg-teal-500/15 text-teal-400 border-teal-500/20",
  other: "bg-white/5 text-[#71717A] border-white/10",
}

const LEARNING_TYPE_STYLE: Record<string, string> = {
  positive_pattern: "text-emerald-400",
  negative_pattern: "text-red-400",
  observation: "text-[#71717A]",
  hypothesis: "text-amber-400",
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RunPills({ summary, isSuccess }: { summary: Record<string, unknown> | null; isSuccess: boolean }) {
  if (!summary || !isSuccess) return null
  const nActions = typeof summary.actions_taken === "number" ? summary.actions_taken : 0
  const nInsights = typeof summary.insights_generated === "number" ? summary.insights_generated : 0
  const nInsightsMeta = typeof summary.insights_created === "number" ? summary.insights_created : 0
  const nVariants = typeof summary.variants_created === "number" ? summary.variants_created : 0
  const nAp = typeof summary.antipatterns_generated === "number" ? summary.antipatterns_generated : 0
  const plateau = Boolean(summary.plateau_detected)
  if (!nActions && !nInsights && !nInsightsMeta && !nVariants && !nAp && !plateau) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {nActions > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          <Zap className="w-2.5 h-2.5" />
          {nActions} action{nActions !== 1 ? "s" : ""}
        </span>
      )}
      {nInsights > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <Sparkles className="w-2.5 h-2.5" />
          {nInsights} insight{nInsights !== 1 ? "s" : ""}
        </span>
      )}
      {nInsightsMeta > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <Sparkles className="w-2.5 h-2.5" />
          {nInsightsMeta} cross-paywall insight{nInsightsMeta !== 1 ? "s" : ""}
        </span>
      )}
      {nVariants > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20">
          <BarChart2 className="w-2.5 h-2.5" />
          {nVariants} variant{nVariants !== 1 ? "s" : ""}
        </span>
      )}
      {plateau && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <AlertTriangle className="w-2.5 h-2.5" />
          plateau
        </span>
      )}
      {nAp > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Shield className="w-2.5 h-2.5" />
          {nAp} antipattern{nAp !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentControlRoom() {
  const supabase = createClient()

  const [runs, setRuns] = useState<AgentRun[]>([])
  const [insights, setInsights] = useState<AgentInsight[]>([])
  const [antipatterns, setAntipatterns] = useState<Antipattern[]>([])
  const [paywalls, setPaywalls] = useState<PaywallStat[]>([])
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeSection, setActiveSection] = useState<"feed" | "insights" | "antipatterns">("feed")

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from("users")
      .select("account_id")
      .eq("id", user.id)
      .single()
    if (!profile?.account_id) { setLoading(false); return }

    const accountId = profile.account_id
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [
      { data: runsData },
      { data: insightsData },
      { data: antipatternsData },
      { data: paywallsData },
    ] = await Promise.all([
      supabase
        .from("agent_runs")
        .select("*, paywalls(headline)")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("agent_insights")
        .select("*, paywalls(headline)")
        .eq("account_id", accountId)
        .order("importance", { ascending: false })
        .order("generated_at", { ascending: false })
        .limit(40),
      supabase
        .from("agent_antipatterns")
        .select("*")
        .eq("account_id", accountId)
        .eq("active", true)
        .order("created_at", { ascending: false }),
      supabase
        .from("paywalls")
        .select("id, headline, status, views, conversions")
        .eq("account_id", accountId)
        .in("status", ["live", "draft"])
        .order("views", { ascending: false }),
    ])

    const paywallIds = (paywallsData ?? []).map((p: { id: string }) => p.id)
    const { data: variantCounts } = paywallIds.length
      ? await supabase
          .from("paywall_variants")
          .select("paywall_id")
          .in("paywall_id", paywallIds)
          .is("archived_at", null)
      : { data: [] }

    const r = (runsData ?? []) as AgentRun[]
    const ins = (insightsData ?? []) as AgentInsight[]

    // Build paywall stats with variant counts
    const variantCountMap: Record<string, number> = {}
    for (const v of (variantCounts ?? [])) {
      variantCountMap[v.paywall_id] = (variantCountMap[v.paywall_id] ?? 0) + 1
    }
    const pwStats: PaywallStat[] = (paywallsData ?? []).map((p: { id: string; headline: string; status: string; views: number; conversions: number }) => ({
      ...p,
      active_variants: variantCountMap[p.id] ?? 0,
    }))

    // KPIs from last 7d
    const recentRuns = r.filter(x => new Date(x.created_at) >= new Date(since7d))
    const succeeded = recentRuns.filter(x => x.status === "succeeded")
    const totalTokens = r.reduce((s, x) => s + (x.tokens_in ?? 0) + (x.tokens_out ?? 0), 0)
    const avgDur = succeeded.length
      ? succeeded.reduce((s, x) => s + (x.duration_ms ?? 0), 0) / succeeded.length
      : 0

    setRuns(r)
    setInsights(ins)
    setAntipatterns((antipatternsData ?? []) as Antipattern[])
    setPaywalls(pwStats)
    setKpis({
      totalRuns: recentRuns.length,
      successRate: recentRuns.length ? Math.round((succeeded.length / recentRuns.length) * 100) : 0,
      insightsTotal: ins.length,
      antipatternTotal: (antipatternsData ?? []).length,
      tokensSpent: totalTokens,
      avgDuration: Math.round(avgDur / 1000),
    })
    setLoading(false)
  }

  async function handleRefresh() {
    setRefreshing(true)
    await loadAll()
    setRefreshing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <Brain className="w-8 h-8 text-indigo-400/40" />
            <motion.div
              className="absolute inset-0"
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <Loader2 className="w-8 h-8 text-indigo-400" />
            </motion.div>
          </div>
          <p className="text-xs text-[#52525B]">Loading agent memory…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0A0A0B]">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
          <Brain className="w-4 h-4 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-white">AI Agent</h1>
          <p className="text-[11px] text-[#52525B]">Autonomous experimentation — read only</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="ml-auto p-2 rounded-lg text-[#52525B] hover:text-[#A1A1AA] hover:bg-white/4 transition-all"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-8">

          {/* ── KPI Cards ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                label: "Runs (7d)",
                value: kpis?.totalRuns ?? 0,
                sub: `${kpis?.successRate ?? 0}% success rate`,
                icon: Activity,
                color: "indigo",
              },
              {
                label: "Insights",
                value: kpis?.insightsTotal ?? 0,
                sub: "Accumulated learnings",
                icon: Sparkles,
                color: "emerald",
              },
              {
                label: "Anti-patterns",
                value: kpis?.antipatternTotal ?? 0,
                sub: "Approaches to avoid",
                icon: Shield,
                color: "amber",
              },
              {
                label: "Tokens used",
                value: kpis?.tokensSpent ? (kpis.tokensSpent > 1000 ? `${(kpis.tokensSpent / 1000).toFixed(0)}k` : kpis.tokensSpent) : 0,
                sub: `Avg ${kpis?.avgDuration ?? 0}s per run`,
                icon: Zap,
                color: "purple",
              },
            ].map((card, i) => (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className={`p-4 rounded-xl border bg-white/2 ${
                  card.color === "indigo" ? "border-indigo-500/15" :
                  card.color === "emerald" ? "border-emerald-500/15" :
                  card.color === "amber" ? "border-amber-500/15" :
                  "border-purple-500/15"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[11px] text-[#71717A] font-medium">{card.label}</p>
                  <card.icon className={`w-3.5 h-3.5 ${
                    card.color === "indigo" ? "text-indigo-400/60" :
                    card.color === "emerald" ? "text-emerald-400/60" :
                    card.color === "amber" ? "text-amber-400/60" :
                    "text-purple-400/60"
                  }`} />
                </div>
                <p className="text-2xl font-bold text-white font-mono">{card.value}</p>
                <p className="text-[10px] text-[#52525B] mt-1">{card.sub}</p>
              </motion.div>
            ))}
          </div>

          {/* ── Paywall overview table ─────────────────────────────── */}
          {paywalls.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-[#71717A] uppercase tracking-wider mb-3">Paywall performance</h2>
              <div className="border border-white/6 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/6 bg-white/2">
                      <th className="text-left px-4 py-2.5 text-[#52525B] font-medium">Paywall</th>
                      <th className="text-right px-4 py-2.5 text-[#52525B] font-medium">
                        <span className="flex items-center justify-end gap-1"><Eye className="w-3 h-3" /> Views</span>
                      </th>
                      <th className="text-right px-4 py-2.5 text-[#52525B] font-medium">
                        <span className="flex items-center justify-end gap-1"><MousePointerClick className="w-3 h-3" /> Conv.</span>
                      </th>
                      <th className="text-right px-4 py-2.5 text-[#52525B] font-medium">Variants</th>
                      <th className="text-right px-4 py-2.5 text-[#52525B] font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paywalls.map((p, i) => (
                      <motion.tr
                        key={p.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.1 + i * 0.04 }}
                        className="border-b border-white/4 last:border-0 hover:bg-white/2 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link href={`/paywalls/${p.id}`} className="flex items-center gap-1.5 group">
                            <span className="text-[#A1A1AA] group-hover:text-white transition-colors truncate max-w-[200px]">
                              {p.headline ?? "Untitled paywall"}
                            </span>
                            <ChevronRight className="w-3 h-3 text-[#52525B] group-hover:text-[#A1A1AA] transition-colors flex-shrink-0" />
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right text-[#71717A] font-mono">{p.views.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-mono font-medium ${parseFloat(convRate(p.views, p.conversions)) > 3 ? "text-emerald-400" : "text-[#71717A]"}`}>
                            {convRate(p.views, p.conversions)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-[#A1A1AA] font-mono">{p.active_variants}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            p.status === "live"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-white/5 text-[#52525B]"
                          }`}>
                            {p.status}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Section tabs ───────────────────────────────────────── */}
          <div>
            <div className="flex gap-1 mb-5 border-b border-white/6">
              {([
                { key: "feed", label: "Activity feed", icon: Activity },
                { key: "insights", label: "Insights", icon: Sparkles },
                { key: "antipatterns", label: "Anti-patterns", icon: Shield },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveSection(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                    activeSection === tab.key
                      ? "text-white border-indigo-500"
                      : "text-[#52525B] border-transparent hover:text-[#A1A1AA]"
                  }`}
                >
                  <tab.icon className="w-3 h-3" />
                  {tab.label}
                  {tab.key === "antipatterns" && antipatterns.length > 0 && (
                    <span className="ml-1 px-1 py-0.5 rounded text-[9px] bg-amber-500/15 text-amber-400 font-semibold">{antipatterns.length}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ── Activity feed ───────────────────────────────────── */}
            <AnimatePresence mode="wait">
              {activeSection === "feed" && (
                <motion.div
                  key="feed"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-2"
                >
                  {runs.length === 0 && (
                    <div className="text-center py-12 text-[#52525B] text-xs">
                      <Brain className="w-8 h-8 mx-auto mb-3 opacity-20" />
                      No agent runs yet. The agent activates automatically once you have 30+ events on a live paywall.
                    </div>
                  )}
                  {runs.map((run, i) => {
                    const Icon = RUN_TYPE_ICONS[run.run_type] ?? Brain
                    const isSuccess = run.status === "succeeded"
                    const isFailed = run.status === "failed"
                    const isRunning = run.status === "running"
                    const summary = run.output_summary

                    return (
                      <motion.div
                        key={run.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.025, duration: 0.2 }}
                        className={`flex gap-3 p-4 rounded-xl border transition-colors ${
                          isSuccess ? "border-white/6 bg-white/2 hover:bg-white/3" :
                          isFailed ? "border-red-500/15 bg-red-500/5" :
                          "border-indigo-500/20 bg-indigo-500/5"
                        }`}
                      >
                        {/* Icon */}
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          isSuccess ? "bg-white/5" :
                          isFailed ? "bg-red-500/10" :
                          "bg-indigo-500/15"
                        }`}>
                          {isRunning ? (
                            <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                          ) : isFailed ? (
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                          ) : (
                            <Icon className="w-3.5 h-3.5 text-indigo-400" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-[#A1A1AA]">
                              {RUN_TYPE_LABELS[run.run_type] ?? run.run_type}
                            </span>
                            {run.paywalls?.headline && (
                              <span className="text-[10px] text-[#52525B] truncate">
                                on &ldquo;{run.paywalls.headline}&rdquo;
                              </span>
                            )}
                            {!run.paywall_id && run.run_type === "meta_reflection" && (
                              <span className="text-[10px] text-indigo-400/60">all paywalls</span>
                            )}
                          </div>

                          {/* Summary */}
                          {run.reasoning && (
                            <p className="text-[11px] text-[#71717A] leading-relaxed mb-2 line-clamp-2">
                              {run.reasoning}
                            </p>
                          )}

                          {/* Output pills */}
                          <RunPills summary={summary} isSuccess={isSuccess} />

                          {/* Meta: actions list */}
                          {Array.isArray(summary?.actions) && (summary!.actions as string[]).length > 0 && (
                            <ul className="mt-2 space-y-0.5">
                              {(summary.actions as string[]).map((a, ai) => (
                                <li key={ai} className="flex items-start gap-1.5 text-[10px] text-[#71717A]">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500/60 flex-shrink-0 mt-0.5" />
                                  {a}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* Meta */}
                        <div className="flex-shrink-0 text-right">
                          <p className="text-[10px] text-[#52525B]">{relativeTime(run.created_at)}</p>
                          {run.duration_ms && (
                            <p className="text-[10px] text-[#3F3F46] mt-0.5 flex items-center justify-end gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {(run.duration_ms / 1000).toFixed(1)}s
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </motion.div>
              )}

              {/* ── Insights ────────────────────────────────────────── */}
              {activeSection === "insights" && (
                <motion.div
                  key="insights"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-2"
                >
                  {insights.length === 0 && (
                    <div className="text-center py-12 text-[#52525B] text-xs">
                      <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-20" />
                      No insights accumulated yet. The agent generates insights after each reflection run.
                    </div>
                  )}
                  {insights.map((ins, i) => (
                    <motion.div
                      key={ins.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.025, duration: 0.2 }}
                      className="flex gap-3 p-4 rounded-xl border border-white/6 bg-white/2 hover:bg-white/3 transition-colors"
                    >
                      {/* Importance indicator */}
                      <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-0.5">
                        <div
                          className="w-1.5 rounded-full"
                          style={{
                            height: `${Math.max(8, (ins.importance / 10) * 32)}px`,
                            background: ins.importance >= 8 ? "#818cf8" : ins.importance >= 5 ? "#6366f1" : "#3730a3",
                          }}
                        />
                        <span className="text-[9px] text-[#52525B] font-mono">{ins.importance}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${CATEGORY_COLORS[ins.category] ?? CATEGORY_COLORS.other}`}>
                            {ins.category}
                          </span>
                          <span className={`text-[10px] font-medium ${LEARNING_TYPE_STYLE[ins.learning_type] ?? "text-[#71717A]"}`}>
                            {ins.learning_type?.replace(/_/g, " ")}
                          </span>
                          {ins.confirmed_count > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400/70">
                              <TrendingUp className="w-2.5 h-2.5" />
                              confirmed ×{ins.confirmed_count + 1}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#A1A1AA] leading-relaxed">{ins.insight}</p>
                        {ins.paywalls?.headline && !ins.paywall_id && (
                          <p className="text-[10px] text-indigo-400/60 mt-1">cross-paywall insight</p>
                        )}
                        {ins.paywalls?.headline && ins.paywall_id && (
                          <p className="text-[10px] text-[#52525B] mt-1 truncate">
                            on &ldquo;{ins.paywalls.headline}&rdquo;
                          </p>
                        )}
                      </div>

                      <div className="flex-shrink-0">
                        <p className="text-[10px] text-[#52525B]">{relativeTime(ins.generated_at)}</p>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}

              {/* ── Anti-patterns ───────────────────────────────────── */}
              {activeSection === "antipatterns" && (
                <motion.div
                  key="antipatterns"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-2"
                >
                  {antipatterns.length === 0 && (
                    <div className="text-center py-12 text-[#52525B] text-xs">
                      <Shield className="w-8 h-8 mx-auto mb-3 opacity-20" />
                      No anti-patterns catalogued yet. The agent identifies these when variants consistently underperform.
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
                    <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <p className="text-[11px] text-amber-400/80">
                      The agent automatically avoids these approaches when generating new variants.
                    </p>
                  </div>

                  {antipatterns.map((ap, i) => (
                    <motion.div
                      key={ap.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.2 }}
                      className="flex gap-3 p-4 rounded-xl border border-amber-500/10 bg-amber-500/3 hover:bg-amber-500/5 transition-colors"
                    >
                      <TrendingDown className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                            {ap.pattern_type?.replace(/_/g, " ")}
                          </span>
                          <span className="text-[10px] text-[#52525B]">
                            {Math.round(ap.confidence * 100)}% confidence
                          </span>
                        </div>
                        <p className="text-xs text-[#A1A1AA] leading-relaxed">{ap.description}</p>
                      </div>
                      <div className="flex-shrink-0">
                        {/* Confidence bar */}
                        <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500/60 rounded-full transition-all"
                            style={{ width: `${ap.confidence * 100}%` }}
                          />
                        </div>
                        <p className="text-[9px] text-[#52525B] mt-0.5 text-right">{relativeTime(ap.created_at)}</p>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

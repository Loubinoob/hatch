"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion } from "framer-motion"
import {
  Loader2, TrendingDown, CalendarDays, BarChart2, ArrowRight,
  MousePointerClick, Clock, X, Monitor, Globe,
  DollarSign, Zap, Activity, Download, HelpCircle, FlaskConical, RotateCcw,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend, LineChart, Line,
} from "recharts"
import { formatMoney, formatPercent } from "@/lib/utils"
import { subDays, format } from "date-fns"
import Link from "next/link"
import { formatPrice, revenuePerImpression } from "@/lib/price-ladder"
import { evaluateDemandCurve, FEATURE_NAMES, N_FEATURES, DemandModelState } from "@/lib/demand-model"
import type { SegmentInput } from "@/lib/segment"
import { Area, AreaChart, ReferenceLine } from "recharts"

const IS_DEV = process.env.NODE_ENV !== "production"

type Funnel = { label: string; count: number; color: string }

const DATE_RANGES = [
  { label: "7d",  days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const

type Tab = "funnel" | "behavior" | "breakdowns" | "quiz" | "pricing"

// ─── Small card ──────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#111114] border border-white/6 rounded-xl p-4">
      <p className="text-xs text-[#71717A] mb-1">{label}</p>
      <p className="font-mono text-xl font-semibold text-white">{value}</p>
      {sub && <p className="text-[10px] text-[#52525B] mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Horizontal bar ──────────────────────────────────────────────────────────
function HBar({ label, value, max, suffix = "" }: { label: string; value: number; max: number; suffix?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-[#A1A1AA] w-28 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="h-full rounded-full bg-indigo-500"
        />
      </div>
      <span className="text-[11px] text-white font-mono w-16 text-right shrink-0">
        {typeof value === "number" && value < 10 ? formatPercent(value) : value.toLocaleString()}{suffix}
      </span>
    </div>
  )
}

export default function AnalyticsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [tab, setTab]     = useState<Tab>("funnel")
  const [dateRange, setDateRange] = useState<7 | 30 | 90>(30)
  const [accountId, setAccountId] = useState<string | null>(null)

  // ── Funnel data ────────────────────────────────────────────────────────────
  const [funnel, setFunnel]           = useState<Funnel[]>([])
  const [revenueByDay, setRevenueByDay] = useState<{ date: string; revenue: number }[]>([])

  // ── Behavior data ──────────────────────────────────────────────────────────
  const [dismissData, setDismissData]  = useState<{ method: string; count: number }[]>([])
  const [avgDwellMs, setAvgDwellMs]    = useState<number>(0)
  const [dwellBuckets, setDwellBuckets] = useState<{ bucket: string; count: number }[]>([])
  const [abandonedRate, setAbandonedRate] = useState<number>(0)
  const [billingToggle, setBillingToggle] = useState<{ monthly: number; yearly: number }>({ monthly: 0, yearly: 0 })
  const [recentBehavior, setRecentBehavior] = useState<{ id: string; event_type: string; created_at: string; properties: Record<string, unknown> }[]>([])

  // ── Behavior extra ─────────────────────────────────────────────────────────
  const [avgScrollDepth, setAvgScrollDepth] = useState<number>(0)

  // ── Breakdown data ─────────────────────────────────────────────────────────
  const [deviceBreakdown, setDeviceBreakdown]   = useState<{ device: string; rate: number; count: number }[]>([])
  const [sourceBreakdown, setSourceBreakdown]   = useState<{ source: string; rate: number; count: number }[]>([])
  const [countryBreakdown, setCountryBreakdown] = useState<{ country: string; rate: number; count: number }[]>([])
  const [variantBreakdown, setVariantBreakdown] = useState<{ name: string; conv: number; views: number }[]>([])

  // ── Quiz data ──────────────────────────────────────────────────────────────
  const [quizStats, setQuizStats] = useState<{
    started: number
    completed: number
    abandoned: number
    completionRate: number
    convConverters: number   // conversions from quiz-completers
    convNonQuiz: number      // conversions from non-quiz impressions
    dropoff: { question_id: string; answered: number; dropped: number }[]
  } | null>(null)

  // ── Pricing data ───────────────────────────────────────────────────────────
  const [pricingData, setPricingData] = useState<{
    plan: { id: string; name: string; price_monthly: number; dynamic_pricing_enabled?: boolean };
    candidates: { id: string; price_cents: number; is_anchor: boolean; impressions: number; conversions: number; rpi: number }[];
    maturity: { maturity_score: number; preferred_engine: string; total_impressions: number; total_conversions: number; distinct_prices_tested: number } | null;
    topVariables: { variable_name: string; importance_score: number; optimal_price_by_value: Record<string, number>; revenue_spread_cents: number }[];
    recentRuns: { id: string; run_type: string; engine: string; data_maturity: number; reasoning: string; actions: unknown[]; created_at: string; model_used: string | null; optimal_by_segment?: Record<string, number> }[];
    demandModel: DemandModelState | null;
    livePrice: number | null;   // current price being served (realtime)
  }[]>([])

  // ── Live price ticker (Supabase Realtime) ────────────────────────────────
  // Updated per-plan when variant_assignments has a new INSERT with price data
  const [livePrices, setLivePrices] = useState<Record<string, number>>({}) // planId → price_shown_cents

  useEffect(() => { initAccount() }, [])
  useEffect(() => { if (accountId) loadAll(accountId, dateRange) }, [accountId, dateRange])

  // ── Live price ticker via Realtime ────────────────────────────────────────
  useEffect(() => {
    if (!accountId) return
    const channel = supabase.channel(`live-prices-${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "variant_assignments",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as any
          if (row.price_shown_cents && row.paywall_id) {
            // We don't easily know the plan_id here; store by paywall for now
            // and cross-reference when rendering
            setLivePrices(prev => ({ ...prev, [`paywall:${row.paywall_id}`]: row.price_shown_cents }))
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  async function initAccount() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
    if (profile?.account_id) setAccountId(profile.account_id)
  }

  async function loadAll(accId: string, days: number) {
    setLoading(true)
    const since = subDays(new Date(), days).toISOString()
    await Promise.all([
      loadFunnel(accId, since, days),
      loadBehavior(accId, since),
      loadBreakdowns(accId, since),
      loadQuiz(accId, since),
      loadPricing(accId),
    ])
    setLoading(false)
  }

  // ── Funnel ─────────────────────────────────────────────────────────────────
  async function loadFunnel(accId: string, since: string, days: number) {
    const eventTypes = ["page_view", "paywall_shown", "plan_selected", "checkout_started", "payment_success"]
    const counts = await Promise.all(
      eventTypes.map(type =>
        supabase.from("events")
          .select("*", { count: "exact", head: true })
          .eq("account_id", accId).eq("event_type", type).gte("created_at", since)
      )
    )
    const labels = ["Page views", "Paywall shown", "Plan selected", "Checkout started", "Payment success"]
    const colors = ["#52525B", "#6366F1", "#8B5CF6", "#F59E0B", "#10B981"]
    setFunnel(labels.map((label, i) => ({ label, count: counts[i].count ?? 0, color: colors[i] })))

    const { data: subs } = await supabase.from("subscriptions")
      .select("created_at, amount_cents").eq("account_id", accId)
      .gte("created_at", since).order("created_at")

    const byDay = new Map<string, number>()
    for (const s of subs ?? []) {
      const day = s.created_at.slice(0, 10)
      byDay.set(day, (byDay.get(day) ?? 0) + s.amount_cents)
    }
    const dayData = []
    for (let i = days - 1; i >= 0; i--) {
      const d = subDays(new Date(), i).toISOString().slice(0, 10)
      dayData.push({ date: d, revenue: byDay.get(d) ?? 0 })
    }
    setRevenueByDay(dayData)
  }

  // ── Behavior ───────────────────────────────────────────────────────────────
  async function loadBehavior(accId: string, since: string) {
    // Dismiss events — method breakdown
    const { data: dismissEvents } = await supabase.from("events")
      .select("properties")
      .eq("account_id", accId).eq("event_type", "paywall_dismissed")
      .gte("created_at", since).limit(2000)

    const methodCounts: Record<string, number> = {}
    let totalDwell = 0, dwellCount = 0
    const dwellBucketMap: Record<string, number> = { "<5s": 0, "5–15s": 0, "15–45s": 0, "45s+": 0 }
    for (const e of dismissEvents ?? []) {
      const p = (e.properties ?? {}) as Record<string, unknown>
      const m = (p.method as string) ?? "unknown"
      methodCounts[m] = (methodCounts[m] ?? 0) + 1
      if (typeof p.dwell_ms === "number") {
        totalDwell += p.dwell_ms; dwellCount++
        const s = p.dwell_ms / 1000
        if (s < 5) dwellBucketMap["<5s"]++
        else if (s < 15) dwellBucketMap["5–15s"]++
        else if (s < 45) dwellBucketMap["15–45s"]++
        else dwellBucketMap["45s+"]++
      }
    }
    setDismissData(Object.entries(methodCounts).map(([method, count]) => ({ method, count })))
    setAvgDwellMs(dwellCount > 0 ? totalDwell / dwellCount : 0)
    setDwellBuckets(Object.entries(dwellBucketMap).map(([bucket, count]) => ({ bucket, count })))

    // Billing toggle split
    const { data: toggleEvents } = await supabase.from("events")
      .select("properties").eq("account_id", accId).eq("event_type", "billing_toggle_changed")
      .gte("created_at", since).limit(1000)
    let monthly = 0, yearly = 0
    for (const e of toggleEvents ?? []) {
      const to = ((e.properties ?? {}) as Record<string, unknown>).to
      if (to === "yearly") yearly++; else monthly++
    }
    setBillingToggle({ monthly, yearly })

    // Checkout abandoned rate
    const [{ count: startedCount }, { count: abandonedCount }] = await Promise.all([
      supabase.from("events").select("*", { count: "exact", head: true })
        .eq("account_id", accId).eq("event_type", "checkout_started").gte("created_at", since),
      supabase.from("events").select("*", { count: "exact", head: true })
        .eq("account_id", accId).eq("event_type", "checkout_abandoned").gte("created_at", since),
    ])
    setAbandonedRate(startedCount ? ((abandonedCount ?? 0) / startedCount) * 100 : 0)

    // Average scroll depth from paywall_impressions (primary source) or scroll_depth events
    try {
      const { data: scrollImpressions } = await supabase
        .from("paywall_impressions")
        .select("scroll_depth_max")
        .eq("account_id", accId)
        .gte("shown_at", since)
        .gt("scroll_depth_max", 0)
        .limit(2000)
      if (scrollImpressions && scrollImpressions.length > 0) {
        const avg = scrollImpressions.reduce((s: number, r: { scroll_depth_max: number }) => s + (r.scroll_depth_max ?? 0), 0) / scrollImpressions.length
        setAvgScrollDepth(Math.round(avg))
      }
    } catch {
      // paywall_impressions table may not exist yet — skip
    }

    // Recent behavioral events table
    const { data: recent } = await supabase.from("events")
      .select("id, event_type, created_at, properties")
      .eq("account_id", accId)
      .in("event_type", ["paywall_shown", "paywall_dismissed", "plan_selected", "cta_clicked",
                          "checkout_started", "checkout_abandoned", "payment_success",
                          "billing_toggle_changed", "quiz_completed", "quiz_abandoned"])
      .gte("created_at", since)
      .order("created_at", { ascending: false }).limit(50)
    setRecentBehavior(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recent ?? []).map((e: any) => ({ ...e, properties: (e.properties ?? {}) as Record<string, unknown> }))
    )
  }

  // ── Breakdowns ─────────────────────────────────────────────────────────────
  async function loadBreakdowns(accId: string, since: string) {
    // Device breakdown — fetch paywall_shown + payment_success and join by session_id
    const [{ data: shown }, { data: paid }] = await Promise.all([
      supabase.from("events").select("session_id, properties")
        .eq("account_id", accId).eq("event_type", "paywall_shown").gte("created_at", since).limit(5000),
      supabase.from("events").select("session_id")
        .eq("account_id", accId).eq("event_type", "payment_success").gte("created_at", since).limit(5000),
    ])

    const paidSessions = new Set((paid ?? []).map((e: { session_id: string | null }) => e.session_id))

    // Group by device
    const deviceShown: Record<string, number> = {}
    const devicePaid: Record<string, number> = {}
    for (const e of shown ?? []) {
      const p = (e.properties ?? {}) as Record<string, unknown>
      const d = (p.device as string) ?? "unknown"
      deviceShown[d] = (deviceShown[d] ?? 0) + 1
      if (paidSessions.has(e.session_id)) devicePaid[d] = (devicePaid[d] ?? 0) + 1
    }
    const deviceRows = Object.entries(deviceShown).map(([device, cnt]) => ({
      device, count: cnt, rate: cnt > 0 ? ((devicePaid[device] ?? 0) / cnt) * 100 : 0,
    })).sort((a, b) => b.count - a.count)
    setDeviceBreakdown(deviceRows)

    // Source breakdown (utm_source)
    const srcShown: Record<string, number> = {}
    const srcPaid: Record<string, number> = {}
    for (const e of shown ?? []) {
      const p = (e.properties ?? {}) as Record<string, unknown>
      const s = (p.utm_source as string) || "direct"
      srcShown[s] = (srcShown[s] ?? 0) + 1
      if (paidSessions.has(e.session_id)) srcPaid[s] = (srcPaid[s] ?? 0) + 1
    }
    const srcRows = Object.entries(srcShown).map(([source, cnt]) => ({
      source, count: cnt, rate: cnt > 0 ? ((srcPaid[source] ?? 0) / cnt) * 100 : 0,
    })).sort((a, b) => b.rate - a.rate).slice(0, 8)
    setSourceBreakdown(srcRows)

    // Country breakdown from paywall_impressions (server-side geo)
    try {
      const { data: impRows } = await supabase
        .from("paywall_impressions")
        .select("country, converted")
        .eq("account_id", accId)
        .gte("shown_at", since)
        .not("country", "is", null)
        .limit(5000)
      if (impRows && impRows.length > 0) {
        const cntShown: Record<string, number> = {}
        const cntPaid:  Record<string, number> = {}
        for (const r of impRows) {
          const c = r.country ?? "Unknown"
          cntShown[c] = (cntShown[c] ?? 0) + 1
          if (r.converted) cntPaid[c] = (cntPaid[c] ?? 0) + 1
        }
        const countryRows = Object.entries(cntShown)
          .map(([country, cnt]) => ({ country, count: cnt, rate: cnt > 0 ? ((cntPaid[country] ?? 0) / cnt) * 100 : 0 }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
        setCountryBreakdown(countryRows)
      }
    } catch {
      // impressions table may not exist yet
    }

    // Variant breakdown
    const { data: variants } = await supabase
      .from("paywall_variants")
      .select("id, name, views, conversions")
      .in("account_id", [accId])
      .is("archived_at", null)
      .order("views", { ascending: false })
      .limit(10)
    setVariantBreakdown((variants ?? []).map((v: { id: string; name: string; views: number; conversions: number }) => ({
      name: v.name, views: v.views, conv: v.views > 0 ? (v.conversions / v.views) * 100 : 0,
    })))
  }

  // ── Quiz ──────────────────────────────────────────────────────────────────
  async function loadQuiz(accId: string, since: string) {
    const [{ count: started }, { count: completed }, { count: abandoned }] = await Promise.all([
      supabase.from("events").select("*", { count: "exact", head: true })
        .eq("account_id", accId).eq("event_type", "quiz_started").gte("created_at", since),
      supabase.from("events").select("*", { count: "exact", head: true })
        .eq("account_id", accId).eq("event_type", "quiz_completed").gte("created_at", since),
      supabase.from("events").select("*", { count: "exact", head: true })
        .eq("account_id", accId).eq("event_type", "quiz_abandoned").gte("created_at", since),
    ])

    const s = started ?? 0
    if (s === 0) { setQuizStats(null); return }
    const c = completed ?? 0
    const ab = abandoned ?? 0

    // Conversion split: quiz-completers vs non-quiz
    let convConverters = 0, convNonQuiz = 0
    try {
      const { data: impRows } = await supabase
        .from("paywall_impressions")
        .select("quiz_completed, converted")
        .eq("account_id", accId)
        .gte("shown_at", since)
        .limit(5000)
      for (const r of impRows ?? []) {
        if (r.converted) {
          if (r.quiz_completed) convConverters++
          else convNonQuiz++
        }
      }
    } catch { /* impressions may not exist */ }

    // Drop-off per question from quiz_question_answered events
    const { data: qaEvents } = await supabase
      .from("events")
      .select("properties")
      .eq("account_id", accId)
      .eq("event_type", "quiz_question_answered")
      .gte("created_at", since)
      .limit(5000)

    const answeredByQ: Record<string, number> = {}
    for (const e of qaEvents ?? []) {
      const qid = (e.properties as Record<string, unknown>)?.question_id as string
      if (qid) answeredByQ[qid] = (answeredByQ[qid] ?? 0) + 1
    }
    const dropoff = Object.entries(answeredByQ).map(([question_id, answered]) => ({
      question_id,
      answered,
      dropped: s - answered,
    })).sort((a, b) => b.answered - a.answered)

    setQuizStats({
      started: s,
      completed: c,
      abandoned: ab,
      completionRate: s > 0 ? (c / s) * 100 : 0,
      convConverters,
      convNonQuiz,
      dropoff,
    })
  }

  // ── Pricing ────────────────────────────────────────────────────────────────
  async function loadPricing(accId: string) {
    // Only select safe columns — dynamic_pricing_enabled & is_active may not exist
    // pre-migration. is_active filter is applied separately below to avoid a
    // query error if the column is missing.
    const { data: plans } = await supabase.from("plans")
      .select("id, name, price_monthly")
      .eq("account_id", accId)

    if (!plans?.length) return

    const planIds = (plans ?? []).map((p: { id: string }) => p.id)

    const [
      { data: candidates },
      { data: maturityRows },
      { data: varImportanceRows },
      { data: scientistRuns },
      demandModelResult,
    ] = await Promise.all([
      supabase.from("plan_price_candidates")
        .select("id, plan_id, price_cents, is_anchor, is_active, interval")
        .eq("account_id", accId).eq("is_active", true).eq("interval", "monthly"),
      supabase.from("pricing_data_maturity")
        .select("plan_id, maturity_score, preferred_engine, total_impressions, total_conversions, distinct_prices_tested")
        .in("plan_id", planIds).eq("segment_hash", "global"),
      supabase.from("pricing_variable_importance")
        .select("plan_id, variable_name, importance_score, optimal_price_by_value, revenue_spread_cents")
        .eq("account_id", accId).in("plan_id", planIds)
        .order("importance_score", { ascending: false }),
      supabase.from("pricing_scientist_runs")
        .select("id, plan_id, run_type, engine, data_maturity, reasoning, actions, created_at, model_used, optimal_by_segment")
        .eq("account_id", accId).in("plan_id", planIds)
        .order("created_at", { ascending: false }).limit(30),
      // Demand models — global segment only for analytics (safe: table may not exist)
      supabase.from("pricing_demand_models")
        .select("plan_id, n_obs, anchor_cents, feature_names, m_vec, q_vec")
        .in("plan_id", planIds)
        .eq("segment_hash", "global"),
    ])

    const candidateIds = (candidates ?? []).map((c: { id: string }) => c.id)
    let posteriorMap: Record<string, { impressions: number; conversions: number; revenue_cents: number }> = {}

    if (candidateIds.length > 0) {
      const { data: posteriors } = await supabase.from("price_point_posteriors")
        .select("price_candidate_id, impressions, conversions, revenue_cents")
        .in("price_candidate_id", candidateIds)

      // Aggregate across all segments
      for (const p of posteriors ?? []) {
        const ex = posteriorMap[p.price_candidate_id] ?? { impressions: 0, conversions: 0, revenue_cents: 0 }
        posteriorMap[p.price_candidate_id] = {
          impressions:   ex.impressions + (p.impressions ?? 0),
          conversions:   ex.conversions + (p.conversions ?? 0),
          revenue_cents: ex.revenue_cents + (p.revenue_cents ?? 0),
        }
      }
    }

    const result = (plans ?? []).map((plan: { id: string; name: string; price_monthly: number }) => {
      const planCandidates = (candidates ?? [])
        .filter((c: { plan_id: string }) => c.plan_id === plan.id)
        .map((c: { id: string; price_cents: number; is_anchor: boolean }) => {
          const post = posteriorMap[c.id] ?? { impressions: 0, conversions: 0, revenue_cents: 0 }
          return {
            ...c,
            ...post,
            rpi: revenuePerImpression(post.conversions, post.impressions, c.price_cents),
          }
        })
        .sort((a: { price_cents: number }, b: { price_cents: number }) => a.price_cents - b.price_cents)

      const maturity = (maturityRows ?? []).find((m: { plan_id: string }) => m.plan_id === plan.id) ?? null
      const topVariables = (varImportanceRows ?? [])
        .filter((v: { plan_id: string }) => v.plan_id === plan.id)
        .slice(0, 3)
      const recentRuns = (scientistRuns ?? [])
        .filter((r: { plan_id: string }) => r.plan_id === plan.id)
        .slice(0, 3)

      // Build demand model state from DB row
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dmRow = (demandModelResult?.data ?? []).find((d: any) => d.plan_id === plan.id)
      let demandModel: DemandModelState | null = null
      if (dmRow && Array.isArray(dmRow.m_vec) && dmRow.m_vec.length === N_FEATURES) {
        demandModel = {
          n_obs:         dmRow.n_obs ?? 0,
          anchor_cents:  dmRow.anchor_cents ?? plan.price_monthly,
          feature_names: dmRow.feature_names ?? FEATURE_NAMES,
          m:             dmRow.m_vec,
          q:             dmRow.q_vec,
        }
      }

      return { plan, candidates: planCandidates, maturity, topVariables, recentRuns, demandModel, livePrice: null }
    })
    setPricingData(result)
  }

  // ─────────────────────────────────────────────────────────────────────────
  const totalRevenue  = revenueByDay.reduce((s, d) => s + d.revenue, 0)
  const paywallShown  = funnel[1]?.count ?? 0
  const conversions   = funnel[4]?.count ?? 0
  const convRate      = paywallShown > 0 ? (conversions / paywallShown) * 100 : 0
  const max           = Math.max(...funnel.map(f => f.count), 1)
  const isEmpty       = !loading && funnel.every(f => f.count === 0) && totalRevenue === 0
  const xInterval     = dateRange === 7 ? 0 : dateRange === 30 ? 4 : 14

  const TABS: { id: Tab; label: string }[] = [
    { id: "funnel",     label: "Funnel" },
    { id: "behavior",   label: "Behavior" },
    { id: "breakdowns", label: "Breakdowns" },
    { id: "quiz",       label: "Quiz" },
    { id: "pricing",    label: "Pricing" },
  ]

  async function exportCsv() {
    if (!accountId) return
    const since = subDays(new Date(), dateRange).toISOString()
    const { data: rows } = await supabase
      .from("events")
      .select("id, event_type, created_at, session_id, user_id_external, paywall_id, properties")
      .eq("account_id", accountId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10000)
    if (!rows?.length) return
    const cols = ["id", "event_type", "created_at", "session_id", "user_id_external", "paywall_id", "properties"]
    const csv = [
      cols.join(","),
      ...rows.map(r => cols.map(c => {
        const v = c === "properties" ? JSON.stringify(r[c as keyof typeof r]) : r[c as keyof typeof r]
        return `"${String(v ?? "").replace(/"/g, '""')}"`
      }).join(","))
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `hatch-events-${dateRange}d-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const dismissColors = ["#6366F1", "#8B5CF6", "#F59E0B", "#10B981", "#EF4444"]

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">Analytics</h1>
          <p className="text-sm text-[#71717A]">Full behavioural funnel + dynamic pricing</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/8 border border-white/10 rounded-lg text-xs text-[#71717A] hover:text-white transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5">
            <CalendarDays className="w-3.5 h-3.5 text-[#52525B] ml-2" />
            {DATE_RANGES.map(r => (
              <button
                key={r.days}
                onClick={() => setDateRange(r.days as 7 | 30 | 90)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  dateRange === r.days ? "bg-white/10 text-white" : "text-[#71717A] hover:text-[#A1A1AA]"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <KpiCard label="Revenue" value={formatMoney(totalRevenue)} sub={`Last ${dateRange} days`} />
        <KpiCard label="Conversions" value={conversions.toLocaleString()} sub="Payments completed" />
        <KpiCard label="Conv. rate" value={formatPercent(convRate)} sub="Views → payments" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-white/6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id ? "text-white border-indigo-500" : "text-[#52525B] border-transparent hover:text-[#A1A1AA]"
            }`}
          >
            {t.label}
          </button>
        ))}
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#52525B] ml-auto self-center mr-1" />}
      </div>

      {/* ── FUNNEL TAB ──────────────────────────────────────────────────────── */}
      {tab === "funnel" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-[#111114] border border-white/6 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-white mb-5">Conversion funnel</h2>
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-10 h-10 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center mb-3">
                  <BarChart2 className="w-5 h-5 text-indigo-400" />
                </div>
                <p className="text-sm font-medium text-white mb-1">No data yet</p>
                <p className="text-xs text-[#52525B] max-w-xs mb-4">Install the SDK and publish a paywall to see funnel data.</p>
                <div className="flex gap-3">
                  <Link href="/paywalls" className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors">
                    Go to paywalls <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {funnel.map((step, i) => {
                    const prev = i > 0 ? funnel[i - 1].count : step.count
                    const dropoff = prev > 0 ? (1 - step.count / prev) * 100 : 0
                    const pct = (step.count / (prev || 1)) * 100
                    return (
                      <div key={step.label}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-[#52525B] w-4">{i + 1}</span>
                            <span className="text-sm text-white">{step.label}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {i > 0 && dropoff > 0 && (
                              <span className="text-xs text-red-400 flex items-center gap-1">
                                <TrendingDown className="w-3 h-3" />{formatPercent(dropoff)} drop
                              </span>
                            )}
                            {i > 0 && <span className="text-xs text-[#52525B]">{formatPercent(pct)} of prev</span>}
                            <span className="font-mono text-sm text-white w-16 text-right">{step.count.toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }} animate={{ width: `${(step.count / max) * 100}%` }}
                            transition={{ delay: i * 0.05, duration: 0.5, ease: "easeOut" }}
                            className="h-full rounded-full" style={{ background: step.color }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4 pt-4 border-t border-white/6 flex items-center justify-between">
                  <p className="text-sm text-[#71717A]">
                    Overall: <span className="text-emerald-400 font-semibold">
                      {funnel[0]?.count > 0 ? formatPercent((funnel[funnel.length - 1]?.count / funnel[0].count) * 100) : "—"}
                    </span>
                  </p>
                  <p className="text-xs text-[#52525B]">Last {dateRange} days</p>
                </div>
              </>
            )}
          </div>

          {/* Revenue chart */}
          <div className="bg-[#111114] border border-white/6 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Revenue</h2>
              <span className="text-xs text-[#52525B]">Last {dateRange} days</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={revenueByDay} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" tickFormatter={d => format(new Date(d), dateRange === 7 ? "EEE" : "MMM d")}
                  tick={{ fill: "#52525B", fontSize: 10 }} tickLine={false} axisLine={false} interval={xInterval} />
                <YAxis tickFormatter={v => formatMoney(v)} tick={{ fill: "#52525B", fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => [formatMoney(Number(v)), "Revenue"]}
                  labelFormatter={l => format(new Date(l), "MMM d, yyyy")}
                />
                <Bar dataKey="revenue" fill="#6366F1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* ── BEHAVIOR TAB ────────────────────────────────────────────────────── */}
      {tab === "behavior" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-5 gap-3">
            <KpiCard label="Avg dwell time" value={avgDwellMs > 0 ? `${(avgDwellMs / 1000).toFixed(1)}s` : "—"} sub="Before dismiss" />
            <KpiCard label="Abandon rate" value={abandonedRate > 0 ? formatPercent(abandonedRate) : "—"} sub="checkout_started → left" />
            <KpiCard label="Yearly toggle" value={billingToggle.yearly > 0 ? `${billingToggle.yearly}×` : "—"} sub="Users who switched" />
            <KpiCard label="Avg scroll depth" value={avgScrollDepth > 0 ? `${avgScrollDepth}%` : "—"} sub="paywall scroll" />
            <KpiCard label="Dismissals" value={dismissData.reduce((s, d) => s + d.count, 0).toLocaleString()} sub={`Last ${dateRange} days`} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Dismiss method donut */}
            <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
              <h3 className="text-xs font-semibold text-white mb-4 flex items-center gap-2">
                <X className="w-3.5 h-3.5 text-[#52525B]" /> Dismiss methods
              </h3>
              {dismissData.length === 0 ? (
                <p className="text-xs text-[#52525B] text-center py-8">No dismiss data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={dismissData} dataKey="count" nameKey="method" cx="50%" cy="50%" outerRadius={65} paddingAngle={3}>
                      {dismissData.map((_, i) => <Cell key={i} fill={dismissColors[i % dismissColors.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 11 }} />
                    <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Dwell time histogram */}
            <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
              <h3 className="text-xs font-semibold text-white mb-4 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-[#52525B]" /> Dwell time distribution
              </h3>
              {dwellBuckets.every(b => b.count === 0) ? (
                <p className="text-xs text-[#52525B] text-center py-8">No dwell data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={dwellBuckets} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis dataKey="bucket" tick={{ fill: "#52525B", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "#52525B", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 11 }} />
                    <Bar dataKey="count" fill="#8B5CF6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Live behavioral event table */}
          <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-white mb-4 flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-[#52525B]" /> Recent behavioral events
            </h3>
            {recentBehavior.length === 0 ? (
              <p className="text-xs text-[#52525B] text-center py-6">No events yet</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {recentBehavior.map(e => (
                  <div key={e.id} className="flex items-center gap-3 text-[11px] py-1.5 border-b border-white/4">
                    <span className="text-[#52525B] w-32 shrink-0">
                      {format(new Date(e.created_at), "MMM d HH:mm")}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                      e.event_type === "payment_success" ? "bg-emerald-500/15 text-emerald-400"
                      : e.event_type === "checkout_abandoned" ? "bg-red-500/15 text-red-400"
                      : e.event_type.startsWith("quiz") ? "bg-purple-500/15 text-purple-400"
                      : "bg-white/5 text-[#71717A]"
                    }`}>
                      {e.event_type}
                    </span>
                    <span className="text-[#71717A] truncate">
                      {Object.entries(e.properties)
                        .filter(([k]) => ["plan_id", "method", "dwell_ms", "to", "percent", "answer"].includes(k))
                        .map(([k, v]) => `${k}: ${k === "dwell_ms" ? `${((v as number) / 1000).toFixed(1)}s` : v}`)
                        .join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── BREAKDOWNS TAB ──────────────────────────────────────────────────── */}
      {tab === "breakdowns" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Device */}
            <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
              <h3 className="text-xs font-semibold text-white mb-4 flex items-center gap-2">
                <Monitor className="w-3.5 h-3.5 text-[#52525B]" /> Conversion by device
              </h3>
              {deviceBreakdown.length === 0
                ? <p className="text-xs text-[#52525B] text-center py-6">No data</p>
                : <div className="space-y-2.5">
                    {deviceBreakdown.map(r => (
                      <HBar key={r.device} label={r.device} value={r.rate}
                        max={Math.max(...deviceBreakdown.map(x => x.rate), 1)} />
                    ))}
                  </div>
              }
            </div>

            {/* Source */}
            <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
              <h3 className="text-xs font-semibold text-white mb-4 flex items-center gap-2">
                <ArrowRight className="w-3.5 h-3.5 text-[#52525B]" /> Conversion by source
              </h3>
              {sourceBreakdown.length === 0
                ? <p className="text-xs text-[#52525B] text-center py-6">No data</p>
                : <div className="space-y-2.5">
                    {sourceBreakdown.map(r => (
                      <HBar key={r.source} label={r.source} value={r.rate}
                        max={Math.max(...sourceBreakdown.map(x => x.rate), 1)} />
                    ))}
                  </div>
              }
            </div>
          </div>

          {/* Country */}
          {countryBreakdown.length > 0 && (
            <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
              <h3 className="text-xs font-semibold text-white mb-4 flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-[#52525B]" /> Conversion by country (top 5)
              </h3>
              <div className="space-y-2.5">
                {countryBreakdown.map(r => (
                  <HBar key={r.country} label={r.country} value={r.rate}
                    max={Math.max(...countryBreakdown.map(x => x.rate), 1)} />
                ))}
              </div>
            </div>
          )}

          {/* Variants */}
          <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-white mb-4 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-[#52525B]" /> Variant performance
            </h3>
            {variantBreakdown.length === 0
              ? <p className="text-xs text-[#52525B] text-center py-6">No variants yet — create A/B tests in the AI optimizer</p>
              : <div className="space-y-2.5">
                  {variantBreakdown.map(r => (
                    <HBar key={r.name} label={r.name} value={r.conv}
                      max={Math.max(...variantBreakdown.map(x => x.conv), 1)} />
                  ))}
                </div>
            }
          </div>
        </motion.div>
      )}

      {/* ── QUIZ TAB ────────────────────────────────────────────────────────── */}
      {tab === "quiz" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {!quizStats ? (
            <div className="bg-[#111114] border border-white/6 rounded-xl p-10 text-center">
              <HelpCircle className="w-8 h-8 text-[#52525B] mx-auto mb-3" />
              <p className="text-sm font-medium text-white mb-1">No quiz data yet</p>
              <p className="text-xs text-[#52525B] max-w-xs mx-auto">
                Quiz analytics appear once you have a paywall with a pre-paywall quiz and at least one impression.
              </p>
            </div>
          ) : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-4 gap-3">
                <KpiCard label="Quiz started" value={quizStats.started.toLocaleString()} sub={`Last ${dateRange} days`} />
                <KpiCard label="Completed" value={quizStats.completed.toLocaleString()} sub={`${formatPercent(quizStats.completionRate)} completion`} />
                <KpiCard label="Abandoned" value={quizStats.abandoned.toLocaleString()} sub="Did not finish" />
                <KpiCard
                  label="Conv. uplift"
                  value={quizStats.convConverters > 0 || quizStats.convNonQuiz > 0
                    ? (quizStats.completed > 0 && quizStats.started - quizStats.completed > 0)
                      ? `+${formatPercent(
                          ((quizStats.convConverters / Math.max(quizStats.completed, 1)) -
                           (quizStats.convNonQuiz / Math.max(quizStats.started - quizStats.completed, 1))) * 100
                        )}`
                      : "—"
                    : "—"}
                  sub="Quiz-completers vs skippers"
                />
              </div>

              {/* Completion bar */}
              <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
                <h3 className="text-xs font-semibold text-white mb-4">Quiz funnel</h3>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-[11px] text-[#71717A] mb-1">
                      <span>Started</span><span className="font-mono">{quizStats.started}</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full"><div className="h-full bg-indigo-500 rounded-full" style={{ width: "100%" }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-[#71717A] mb-1">
                      <span>Completed</span>
                      <span className="font-mono">{quizStats.completed} ({formatPercent(quizStats.completionRate)})</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${quizStats.completionRate}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-[#71717A] mb-1">
                      <span>Abandoned</span>
                      <span className="font-mono">{quizStats.abandoned} ({formatPercent(quizStats.started > 0 ? (quizStats.abandoned / quizStats.started) * 100 : 0)})</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full">
                      <div className="h-full bg-red-500/60 rounded-full" style={{ width: `${quizStats.started > 0 ? (quizStats.abandoned / quizStats.started) * 100 : 0}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-question drop-off */}
              {quizStats.dropoff.length > 0 && (
                <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
                  <h3 className="text-xs font-semibold text-white mb-4">Answer count per question</h3>
                  <div className="space-y-2.5">
                    {quizStats.dropoff.map((q, i) => (
                      <HBar
                        key={q.question_id}
                        label={`Q${i + 1}: ${q.question_id.slice(0, 12)}…`}
                        value={q.answered}
                        max={quizStats.started}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Conversion uplift breakdown */}
              {(quizStats.convConverters > 0 || quizStats.convNonQuiz > 0) && (
                <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
                  <h3 className="text-xs font-semibold text-white mb-4">Conversion: quiz-completers vs skippers</h3>
                  <div className="space-y-2.5">
                    <HBar
                      label="Quiz-completers"
                      value={quizStats.completed > 0 ? (quizStats.convConverters / quizStats.completed) * 100 : 0}
                      max={100}
                      suffix="%"
                    />
                    <HBar
                      label="Skippers"
                      value={(quizStats.started - quizStats.completed) > 0
                        ? (quizStats.convNonQuiz / (quizStats.started - quizStats.completed)) * 100
                        : 0}
                      max={100}
                      suffix="%"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}

      {/* ── PRICING TAB ─────────────────────────────────────────────────────── */}
      {tab === "pricing" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {pricingData.length === 0 ? (
            <div className="bg-[#111114] border border-white/6 rounded-xl p-10 text-center">
              <DollarSign className="w-8 h-8 text-[#52525B] mx-auto mb-3" />
              <p className="text-sm font-medium text-white mb-1">No price candidates yet</p>
              <p className="text-xs text-[#52525B] max-w-xs mx-auto">
                Price candidates are generated automatically when your paywall is shown for the first time.
              </p>
            </div>
          ) : (
            pricingData.map(({ plan, candidates, maturity, topVariables, recentRuns, demandModel }) => {
              const maxRpi = Math.max(...candidates.map(c => c.rpi), 1)
              const winner = candidates.length > 0 ? candidates.reduce((a, b) => a.rpi >= b.rpi ? a : b, candidates[0]) : null
              const maturityPct = maturity ? Math.round(maturity.maturity_score * 100) : 0
              const engineLabel = maturity?.preferred_engine === "in_house_model" ? "Model-driven" : "Claude-driven"
              const engineColor = maturity?.preferred_engine === "in_house_model" ? "text-purple-400" : "text-indigo-400"

              // ── Demand model analytics ─────────────────────────────────────
              // Elasticity: the price_norm coefficient (m[1]) captures d(logit)/d(price_norm)
              // Negative = price-elastic (higher price → fewer conversions)
              const priceCoeff = demandModel ? demandModel.m[1] : null
              const elasticityLabel = priceCoeff === null ? null
                : priceCoeff < -2   ? { text: "Highly elastic",    color: "text-red-400" }
                : priceCoeff < -0.5 ? { text: "Price-sensitive",   color: "text-amber-400" }
                : priceCoeff < 0.2  ? { text: "Moderate elasticity", color: "text-blue-400" }
                : { text: "Inelastic / prestige",   color: "text-emerald-400" }

              // Build demand curve for visualization
              const neutralSeg: SegmentInput = { quiz_answers: {}, utm_source: null, device: "desktop", returning: false, hour_bucket: "morning" }
              const priceLadder = candidates.length > 0
                ? candidates.map(c => c.price_cents)
                : []
              const demandCurvePoints = demandModel && demandModel.n_obs > 0 && priceLadder.length > 1
                ? evaluateDemandCurve(demandModel, priceLadder, neutralSeg)
                : null

              // Live price: most recent ticker for this plan (from realtime state)
              // We don't store paywall_id per plan easily; check all paywall live prices
              // via the plan's candidates (any price in candidates list)
              const latestLiveKey = Object.keys(livePrices).find(k =>
                k.startsWith("paywall:") && Object.values(livePrices).includes(livePrices[k])
              )
              const latestLivePrice = latestLiveKey ? livePrices[latestLiveKey] : null

              // Optimal by segment from most recent scientist run
              const latestRunWithSegments = recentRuns.find(r => r.optimal_by_segment && Object.keys(r.optimal_by_segment ?? {}).length > 1)
              const optimalBySegment = latestRunWithSegments?.optimal_by_segment ?? null

              return (
                <div key={plan.id} className="bg-[#111114] border border-white/6 rounded-xl p-5 space-y-5">
                  {/* Plan header */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-white">{plan.name}</h3>
                        {/* Live price ticker */}
                        {latestLivePrice && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[9px] text-emerald-400 font-mono">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                            {formatPrice(latestLivePrice)} live
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#52525B] mt-0.5">
                        Anchor: {formatPrice(plan.price_monthly)} ·{" "}
                        <span className={plan.dynamic_pricing_enabled ? "text-emerald-400" : "text-[#52525B]"}>
                          {plan.dynamic_pricing_enabled ? "Dynamic pricing ON" : "Fixed price"}
                        </span>
                        {elasticityLabel && (
                          <>
                            {" "}·{" "}
                            <span className={elasticityLabel.color}>{elasticityLabel.text}</span>
                            {demandModel && (
                              <span className="text-[#52525B]"> ({demandModel.n_obs} obs · ε={priceCoeff?.toFixed(2)})</span>
                            )}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Data maturity badge */}
                      {maturity && (
                        <div className="text-right">
                          <div className="flex items-center gap-2 justify-end mb-1">
                            <span className={`text-[10px] font-medium ${engineColor}`}>{engineLabel}</span>
                            <span className="text-[10px] text-[#52525B]">{maturityPct}% mature</span>
                          </div>
                          <div className="w-24 h-1 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${maturity.preferred_engine === "in_house_model" ? "bg-purple-500" : "bg-indigo-500"}`}
                              style={{ width: `${maturityPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {winner && candidates.some(c => c.impressions > 0) && (
                        <div className="text-right">
                          <p className="text-[10px] text-[#52525B]">Best price</p>
                          <p className="text-sm font-mono font-semibold text-emerald-400">{formatPrice(winner.price_cents)}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {candidates.length === 0 ? (
                    <p className="text-xs text-[#52525B]">No candidates yet — will bootstrap on first impression</p>
                  ) : (
                    <>
                      {/* Elasticity chart */}
                      <div>
                        <p className="text-[10px] text-[#52525B] mb-2">Revenue per impression by price point</p>
                        <ResponsiveContainer width="100%" height={120}>
                          <LineChart data={candidates.map(c => ({ price: formatPrice(c.price_cents), rpi: c.rpi, impressions: c.impressions }))}>
                            <XAxis dataKey="price" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis tickFormatter={v => formatMoney(v)} tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                            <Tooltip
                              contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 11 }}
                              formatter={(v, name) => [name === "rpi" ? formatMoney(Number(v)) : v, name === "rpi" ? "Rev/impression" : "Impressions"]}
                            />
                            <Line type="monotone" dataKey="rpi" stroke="#6366F1" strokeWidth={2} dot={{ fill: "#6366F1", r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Candidates table */}
                      <div className="space-y-1.5">
                        {candidates.map(c => {
                          const isWinner = winner && c.id === winner.id && c.impressions > 10
                          return (
                            <div key={c.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${isWinner ? "bg-emerald-500/5 border border-emerald-500/15" : "bg-white/2"}`}>
                              <span className="font-mono text-sm text-white w-14">{formatPrice(c.price_cents)}</span>
                              {c.is_anchor && <span className="text-[9px] bg-white/8 text-[#71717A] px-1.5 py-0.5 rounded">anchor</span>}
                              {isWinner && <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded">best RPI</span>}
                              <div className="flex-1 grid grid-cols-3 gap-2 text-[11px] text-[#71717A]">
                                <span>{c.impressions} imp.</span>
                                <span>{c.impressions > 0 && c.conversions > 0 ? formatPercent((c.conversions / c.impressions) * 100) : "—"} conv</span>
                                <span className="text-white">{c.rpi > 0 ? `${formatMoney(c.rpi)}/imp` : "—"}</span>
                              </div>
                              <div className="w-20 h-1 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(c.rpi / maxRpi) * 100}%` }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}

                  {/* ── Demand curve (B.1) ─────────────────────────────────── */}
                  {demandCurvePoints && demandCurvePoints.length >= 2 && (
                    <div className="border-t border-white/6 pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wide">
                          Demand curve — P(convert) vs price
                        </p>
                        <span className="text-[9px] text-[#52525B]">
                          Chapelle-Li model · {demandModel?.n_obs} obs · 95% CI
                        </span>
                      </div>
                      <ResponsiveContainer width="100%" height={160}>
                        <AreaChart
                          data={demandCurvePoints.map(pt => ({
                            price: formatPrice(pt.price_cents),
                            price_cents: pt.price_cents,
                            conv: Math.round(pt.conv_prob * 1000) / 10,
                            conv_low: Math.round(pt.conv_low * 1000) / 10,
                            conv_high: Math.round(pt.conv_high * 1000) / 10,
                            rpi: pt.rpi_cents,
                          }))}
                          margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                        >
                          <XAxis dataKey="price" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis
                            tickFormatter={v => `${v}%`}
                            tick={{ fill: "#52525B", fontSize: 10 }}
                            axisLine={false} tickLine={false}
                          />
                          <Tooltip
                            contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 11 }}
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={(v: any, name: any) => {
                              const n = typeof v === "number" ? v : 0
                              if (name === "conv") return [`${n.toFixed(1)}%`, "Conv. prob (mean)"]
                              if (name === "conv_high") return [`${n.toFixed(1)}%`, "Conv. CI high"]
                              if (name === "conv_low") return [`${n.toFixed(1)}%`, "Conv. CI low"]
                              return [v, name]
                            }}
                          />
                          {/* CI band */}
                          <Area type="monotone" dataKey="conv_high" stroke="none" fill="#6366F1" fillOpacity={0.12} legendType="none" />
                          <Area type="monotone" dataKey="conv_low" stroke="none" fill="#111114" fillOpacity={1} legendType="none" />
                          {/* Mean line */}
                          <Area type="monotone" dataKey="conv" stroke="#6366F1" strokeWidth={2} fill="#6366F1" fillOpacity={0.05} dot={{ fill: "#6366F1", r: 3 }} />
                          {/* Anchor reference line */}
                          {demandModel && (
                            <ReferenceLine
                              x={formatPrice(demandModel.anchor_cents)}
                              stroke="#F59E0B"
                              strokeDasharray="4 3"
                              label={{ value: "anchor", fill: "#F59E0B", fontSize: 9, position: "top" }}
                            />
                          )}
                        </AreaChart>
                      </ResponsiveContainer>
                      <p className="text-[10px] text-[#52525B] mt-1">
                        Shaded band = 95% predictive interval. Dashed line = anchor price.
                        RPI optimal: {winner ? formatPrice(winner.price_cents) : "—"}
                      </p>
                    </div>
                  )}

                  {/* ── Optimal price by segment (B.6) ─────────────────────── */}
                  {optimalBySegment && Object.keys(optimalBySegment).length > 1 && (
                    <div className="border-t border-white/6 pt-4">
                      <p className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wide mb-3">
                        Optimal price by segment
                      </p>
                      <div className="space-y-1.5">
                        {Object.entries(optimalBySegment)
                          .sort(([a], [b]) => a === "global" ? -1 : b === "global" ? 1 : 0)
                          .slice(0, 8)
                          .map(([seg, priceCents]) => (
                            <div key={seg} className="flex items-center gap-3">
                              <span className="text-[10px] text-[#71717A] w-32 truncate">
                                {seg === "global" ? "🌐 global" : seg}
                              </span>
                              <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-violet-500 rounded-full"
                                  style={{ width: `${((priceCents as number) / Math.max(...Object.values(optimalBySegment) as number[], 1)) * 100}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-white w-10 text-right">
                                {formatPrice(priceCents as number)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Variable importance */}
                  {topVariables.length > 0 && (
                    <div className="border-t border-white/6 pt-4">
                      <p className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wide mb-3">
                        Pricing variables — what drives WTP
                      </p>
                      <div className="space-y-3">
                        {topVariables.map((v) => {
                          const maxOptimal = Math.max(...Object.values(v.optimal_price_by_value), 1)
                          return (
                            <div key={v.variable_name}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] font-medium text-white">{v.variable_name}</span>
                                <span className="text-[10px] text-[#52525B]">
                                  importance {Math.round(v.importance_score * 100)}% · spread {formatPrice(v.revenue_spread_cents)}/imp
                                </span>
                              </div>
                              <div className="space-y-1">
                                {Object.entries(v.optimal_price_by_value).slice(0, 4).map(([val, priceCents]) => (
                                  <div key={val} className="flex items-center gap-2">
                                    <span className="text-[10px] text-[#71717A] w-20 truncate">{val}</span>
                                    <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-violet-500 rounded-full"
                                        style={{ width: `${(priceCents / maxOptimal) * 100}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] font-mono text-white w-10 text-right">{formatPrice(priceCents)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Scientist run timeline */}
                  {recentRuns.length > 0 && (
                    <div className="border-t border-white/6 pt-4">
                      <p className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wide mb-3">
                        Recent scientist runs
                      </p>
                      <div className="space-y-2">
                        {recentRuns.map((run) => (
                          <div key={run.id} className="flex gap-3 text-[11px]">
                            <div className="flex flex-col items-center">
                              <div className={`w-2 h-2 rounded-full mt-0.5 shrink-0 ${run.engine === "claude" ? "bg-indigo-500" : "bg-purple-500"}`} />
                              <div className="flex-1 w-px bg-white/6 mt-1" />
                            </div>
                            <div className="pb-2 flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
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
                                <p className="text-[#71717A] line-clamp-2">{run.reasoning}</p>
                              )}
                              {Array.isArray(run.actions) && run.actions.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
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
                </div>
              )
            })
          )}

          {/* ── Dev-only Simulator Panel ──────────────────────────────────── */}
          {IS_DEV && <SimulatorPanel accountId={accountId} />}
        </motion.div>
      )}
    </div>
  )
}

// ─── Simulator Panel (dev only) ───────────────────────────────────────────────
type SimReport = {
  served_price_distribution_over_time: { after_n: number; price_share: Record<string, number>; avg_price_cents: number }[]
  final_optimal_by_segment: Record<string, number>
  ground_truth_optimal_by_segment: Record<string, number>
  convergence_gap_cents: number
  top_variable_found: string | null
  top_variable_expected: string
  top_variable_match: boolean
  total_simulated_revenue_cents: number
  regret_vs_oracle_cents: number
  candidates_used: { price_cents: number; is_anchor: boolean }[]
}

type SimPlan = { id: string; name: string; price_monthly: number }

function SimulatorPanel({ accountId }: { accountId: string | null }) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [report, setReport] = useState<SimReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Plan list — loaded independently using only safe columns
  const [plans, setPlans] = useState<SimPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [planId, setPlanId] = useState("")

  const [nUsers, setNUsers] = useState(2000)
  const [midpoint, setMidpoint] = useState(3500)
  const [discVar, setDiscVar] = useState("utm_source")
  const [scientistEvery, setScientistEvery] = useState(500)

  // Load plans when panel opens (or accountId is ready)
  useEffect(() => {
    if (!open || !accountId) return
    setPlansLoading(true)
    supabase.from("plans")
      // Only safe columns — avoids PGRST error if optional columns are missing
      .select("id, name, price_monthly")
      .eq("account_id", accountId)
      .order("name")
      .then(({ data }) => {
        const rows = (data ?? []) as SimPlan[]
        setPlans(rows)
        if (rows.length > 0 && !planId) setPlanId(rows[0].id)
        setPlansLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId])

  async function runSim() {
    if (!planId) return
    setRunning(true)
    setReport(null)
    setError(null)
    try {
      const res = await fetch("/api/dev/simulate-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planId,
          n_users: nUsers,
          scientist_every: scientistEvery,
          ground_truth: {
            base: 0.15,
            midpoint_cents: midpoint,
            steepness: 0.0008,
            discriminating_variable: discVar,
            willingness_by_value: { organic: 1.6, social: 0.7, direct: 1.0 },
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Simulation failed")
      setReport(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setRunning(false)
    }
  }

  async function resetSim() {
    if (!planId) return
    setResetting(true)
    try {
      await fetch(`/api/dev/reset-simulation?plan_id=${planId}`, { method: "DELETE" })
      setReport(null)
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="border border-amber-500/20 bg-amber-500/5 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left"
      >
        <FlaskConical className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="text-xs font-semibold text-amber-400">Price Bandit Simulator</span>
        <span className="text-[10px] text-amber-500/70 ml-1">dev only</span>
        <span className="ml-auto text-[10px] text-amber-500/50">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          <p className="text-[11px] text-amber-500/70">
            Simulates synthetic users against a planted demand curve to verify bandit convergence.
            Writes to <code className="font-mono">price_point_posteriors</code> with{" "}
            <code className="font-mono">segment_hash LIKE &apos;sim:%&apos;</code>.
          </p>

          {/* Config */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#71717A] mb-1 block">Plan</label>
              {plansLoading ? (
                <div className="flex items-center gap-1.5 h-7 text-[10px] text-[#52525B]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading plans…
                </div>
              ) : plans.length === 0 ? (
                <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1.5">
                  No plans found. <Link href="/plans" className="underline hover:text-amber-300">Create a plan first.</Link>
                </div>
              ) : (
                <select
                  value={planId}
                  onChange={e => setPlanId(e.target.value)}
                  className="w-full bg-[#111114] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — ${(p.price_monthly / 100).toFixed(0)}/mo
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="text-[10px] text-[#71717A] mb-1 block">N users</label>
              <input
                type="number" value={nUsers} onChange={e => setNUsers(Number(e.target.value))}
                min={100} max={20000} step={100}
                className="w-full bg-[#111114] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#71717A] mb-1 block">Midpoint (¢) — WTP peak</label>
              <input
                type="number" value={midpoint} onChange={e => setMidpoint(Number(e.target.value))}
                min={500} max={20000} step={100}
                className="w-full bg-[#111114] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#71717A] mb-1 block">Discriminating variable</label>
              <input
                type="text" value={discVar} onChange={e => setDiscVar(e.target.value)}
                className="w-full bg-[#111114] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#71717A] mb-1 block">Scientist every N users</label>
              <input
                type="number" value={scientistEvery} onChange={e => setScientistEvery(Number(e.target.value))}
                min={100} max={2000} step={100}
                className="w-full bg-[#111114] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={runSim}
              disabled={running || !planId || plans.length === 0}
              title={plans.length === 0 ? "Create a plan first" : undefined}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-xs font-semibold rounded-lg transition-colors"
            >
              {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3" />}
              {running ? "Simulating…" : "Run simulation"}
            </button>
            <button
              onClick={resetSim}
              disabled={resetting || !planId || plans.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-[#71717A] hover:text-white text-xs rounded-lg transition-colors border border-white/10"
            >
              {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              Reset sim data
            </button>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2.5 space-y-1">
              <p className="font-semibold">Simulation error</p>
              <p className="font-mono text-[10px] text-red-300/80 whitespace-pre-wrap break-all">{error}</p>
              {error.includes("migration") || error.includes("Schema") ? (
                <p className="text-red-400/70">→ Run <code className="font-mono bg-red-500/10 px-1 rounded">supabase db push</code> on your production database to apply pending migrations.</p>
              ) : null}
            </div>
          )}

          {report && (
            <div className="space-y-4">
              {/* Summary KPIs */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#111114] rounded-lg p-3">
                  <p className="text-[10px] text-[#52525B] mb-0.5">Convergence gap</p>
                  <p className={`font-mono text-sm font-semibold ${report.convergence_gap_cents < 200 ? "text-emerald-400" : report.convergence_gap_cents < 1000 ? "text-amber-400" : "text-red-400"}`}>
                    {formatPrice(report.convergence_gap_cents)}
                  </p>
                  <p className="text-[10px] text-[#52525B]">vs ground truth</p>
                </div>
                <div className="bg-[#111114] rounded-lg p-3">
                  <p className="text-[10px] text-[#52525B] mb-0.5">Variable found</p>
                  <p className={`text-sm font-semibold ${report.top_variable_match ? "text-emerald-400" : "text-red-400"}`}>
                    {report.top_variable_found ?? "—"} {report.top_variable_match ? "✓" : "✗"}
                  </p>
                  <p className="text-[10px] text-[#52525B]">expected: {report.top_variable_expected}</p>
                </div>
                <div className="bg-[#111114] rounded-lg p-3">
                  <p className="text-[10px] text-[#52525B] mb-0.5">Regret vs oracle</p>
                  <p className="font-mono text-sm font-semibold text-white">
                    {formatMoney(report.regret_vs_oracle_cents)}
                  </p>
                  <p className="text-[10px] text-[#52525B]">{formatMoney(report.total_simulated_revenue_cents)} earned</p>
                </div>
              </div>

              {/* Price distribution over time */}
              {report.served_price_distribution_over_time.length > 0 && (
                <div className="bg-[#111114] rounded-lg p-4">
                  <p className="text-[11px] text-white font-semibold mb-3">Price distribution over time (avg served price)</p>
                  <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={report.served_price_distribution_over_time}>
                      <XAxis dataKey="after_n" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis
                        tickFormatter={v => `$${Math.round(v / 100)}`}
                        tick={{ fill: "#52525B", fontSize: 10 }}
                        axisLine={false} tickLine={false}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 11 }}
                        formatter={(v) => [formatPrice(Number(v)), "Avg price served"]}
                      />
                      <Line type="monotone" dataKey="avg_price_cents" stroke="#F59E0B" strokeWidth={2} dot={{ fill: "#F59E0B", r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-[#52525B] mt-1">
                    Ground-truth optimal: {formatPrice(report.ground_truth_optimal_by_segment.global ?? 0)} · System found: {formatPrice(report.final_optimal_by_segment.global ?? 0)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion } from "framer-motion"
import {
  Loader2, TrendingDown, CalendarDays, BarChart2, ArrowRight,
  MousePointerClick, Clock, X, Monitor, Smartphone, Tablet,
  DollarSign, Zap, Activity, Download,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend, LineChart, Line,
} from "recharts"
import { formatMoney, formatPercent } from "@/lib/utils"
import { subDays, format } from "date-fns"
import Link from "next/link"
import { formatPrice, revenuePerImpression } from "@/lib/price-ladder"

type Funnel = { label: string; count: number; color: string }

const DATE_RANGES = [
  { label: "7d",  days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const

type Tab = "funnel" | "behavior" | "breakdowns" | "pricing"

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

  // ── Breakdown data ─────────────────────────────────────────────────────────
  const [deviceBreakdown, setDeviceBreakdown]  = useState<{ device: string; rate: number; count: number }[]>([])
  const [sourceBreakdown, setSourceBreakdown]  = useState<{ source: string; rate: number; count: number }[]>([])
  const [variantBreakdown, setVariantBreakdown] = useState<{ name: string; conv: number; views: number }[]>([])

  // ── Pricing data ───────────────────────────────────────────────────────────
  const [pricingData, setPricingData] = useState<{
    plan: { id: string; name: string; price_monthly: number; dynamic_pricing_enabled: boolean };
    candidates: { id: string; price_cents: number; is_anchor: boolean; impressions: number; conversions: number; rpi: number }[]
  }[]>([])

  useEffect(() => { initAccount() }, [])
  useEffect(() => { if (accountId) loadAll(accountId, dateRange) }, [accountId, dateRange])

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

  // ── Pricing ────────────────────────────────────────────────────────────────
  async function loadPricing(accId: string) {
    const { data: plans } = await supabase.from("plans")
      .select("id, name, price_monthly, dynamic_pricing_enabled")
      .eq("account_id", accId).eq("is_active", true)

    if (!plans?.length) return

    const { data: candidates } = await supabase.from("plan_price_candidates")
      .select("id, plan_id, price_cents, is_anchor, is_active, interval")
      .eq("account_id", accId).eq("is_active", true).eq("interval", "monthly")

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

    const result = (plans ?? []).map((plan: { id: string; name: string; price_monthly: number; dynamic_pricing_enabled: boolean }) => {
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
      return { plan, candidates: planCandidates }
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
    { id: "pricing",    label: "Pricing" },
  ]

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
          <div className="grid grid-cols-4 gap-3">
            <KpiCard label="Avg dwell time" value={avgDwellMs > 0 ? `${(avgDwellMs / 1000).toFixed(1)}s` : "—"} sub="Before dismiss" />
            <KpiCard label="Abandon rate" value={abandonedRate > 0 ? formatPercent(abandonedRate) : "—"} sub="checkout_started → left" />
            <KpiCard label="Yearly toggle" value={billingToggle.yearly > 0 ? `${billingToggle.yearly}×` : "—"} sub="Users who switched" />
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
            pricingData.map(({ plan, candidates }) => {
              const maxRpi = Math.max(...candidates.map(c => c.rpi), 1)
              const winner = candidates.reduce((a, b) => a.rpi >= b.rpi ? a : b, candidates[0])
              return (
                <div key={plan.id} className="bg-[#111114] border border-white/6 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">{plan.name}</h3>
                      <p className="text-[11px] text-[#52525B] mt-0.5">
                        Anchor: {formatPrice(plan.price_monthly)} ·{" "}
                        <span className={plan.dynamic_pricing_enabled ? "text-emerald-400" : "text-[#52525B]"}>
                          {plan.dynamic_pricing_enabled ? "Dynamic pricing ON" : "Fixed price"}
                        </span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-[#52525B]">Best price so far</p>
                      <p className="text-sm font-mono font-semibold text-emerald-400">
                        {candidates.some(c => c.impressions > 0) ? formatPrice(winner.price_cents) : "—"}
                      </p>
                    </div>
                  </div>

                  {candidates.length === 0 ? (
                    <p className="text-xs text-[#52525B]">No candidates yet — will bootstrap on first impression</p>
                  ) : (
                    <>
                      {/* Elasticity scatter */}
                      <div className="mb-4">
                        <p className="text-[10px] text-[#52525B] mb-2">Revenue per impression by price point</p>
                        <ResponsiveContainer width="100%" height={120}>
                          <LineChart data={candidates.map(c => ({ price: formatPrice(c.price_cents), rpi: c.rpi, impressions: c.impressions }))}>
                            <XAxis dataKey="price" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis tickFormatter={v => formatMoney(v)} tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                            <Tooltip
                              contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 11 }}
                              formatter={(v, name) => [name === "rpi" ? formatMoney(Number(v)) : v, name === "rpi" ? "Revenue/impression" : "Impressions"]}
                            />
                            <Line type="monotone" dataKey="rpi" stroke="#6366F1" strokeWidth={2} dot={{ fill: "#6366F1", r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Candidates table */}
                      <div className="space-y-2">
                        {candidates.map(c => {
                          const isWinner = c.rpi === maxRpi && c.impressions > 10
                          return (
                            <div key={c.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${isWinner ? "bg-emerald-500/5 border border-emerald-500/15" : "bg-white/2"}`}>
                              <span className="font-mono text-sm text-white w-14">{formatPrice(c.price_cents)}</span>
                              {c.is_anchor && <span className="text-[9px] bg-white/8 text-[#71717A] px-1.5 py-0.5 rounded">anchor</span>}
                              {isWinner && <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded">best RPI</span>}
                              <div className="flex-1 grid grid-cols-3 gap-2 text-[11px] text-[#71717A]">
                                <span>{c.impressions} imp.</span>
                                <span>{c.conversions > 0 ? formatPercent((c.conversions / c.impressions) * 100) : "—"} conv</span>
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
                </div>
              )
            })
          )}
        </motion.div>
      )}
    </div>
  )
}

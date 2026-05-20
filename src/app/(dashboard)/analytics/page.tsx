"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion } from "framer-motion"
import { Loader2, TrendingDown, CalendarDays, BarChart2, ArrowRight } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { formatMoney, formatPercent } from "@/lib/utils"
import { subDays, format } from "date-fns"
import Link from "next/link"

type Funnel = { label: string; count: number; color: string }

const DATE_RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const

export default function AnalyticsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [funnel, setFunnel] = useState<Funnel[]>([])
  const [revenueByDay, setRevenueByDay] = useState<{ date: string; revenue: number }[]>([])
  const [dateRange, setDateRange] = useState<7 | 30 | 90>(30)
  const [accountId, setAccountId] = useState<string | null>(null)

  useEffect(() => {
    initAccount()
  }, [])

  useEffect(() => {
    if (accountId) loadAnalytics(accountId, dateRange)
  }, [accountId, dateRange])

  async function initAccount() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
    if (profile?.account_id) setAccountId(profile.account_id)
  }

  async function loadAnalytics(accId: string, days: number) {
    setLoading(true)
    const since = subDays(new Date(), days).toISOString()

    const eventTypes = ["page_view", "paywall_shown", "plan_selected", "checkout_started", "payment_success"]
    const counts = await Promise.all(
      eventTypes.map(type =>
        supabase.from("events")
          .select("*", { count: "exact", head: true })
          .eq("account_id", accId)
          .eq("event_type", type)
          .gte("created_at", since)
      )
    )

    const labels = ["Page views", "Paywall shown", "Plan selected", "Checkout started", "Payment success"]
    const colors = ["#52525B", "#6366F1", "#8B5CF6", "#F59E0B", "#10B981"]
    setFunnel(labels.map((label, i) => ({ label, count: counts[i].count ?? 0, color: colors[i] })))

    // Revenue by day
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("created_at, amount_cents")
      .eq("account_id", accId)
      .gte("created_at", since)
      .order("created_at")

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
    setLoading(false)
  }

  const totalRevenue = revenueByDay.reduce((s, d) => s + d.revenue, 0)
  const isEmpty = !loading && funnel.every(f => f.count === 0) && totalRevenue === 0
  const max = Math.max(...funnel.map(f => f.count), 1)
  const paywallShown = funnel[1]?.count ?? 0
  const conversions = funnel[4]?.count ?? 0
  const overallConvRate = paywallShown > 0 ? (conversions / paywallShown) * 100 : 0

  const xInterval = dateRange === 7 ? 0 : dateRange === 30 ? 4 : 14

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">Analytics</h1>
          <p className="text-sm text-[#71717A]">Understand your monetization funnel</p>
        </div>

        {/* Date range picker */}
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

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-[#111114] border border-white/6 rounded-xl p-4">
          <p className="text-xs text-[#71717A] mb-1">Revenue</p>
          <p className="font-mono text-xl font-semibold text-white">{formatMoney(totalRevenue)}</p>
          <p className="text-[10px] text-[#52525B] mt-0.5">Last {dateRange} days</p>
        </div>
        <div className="bg-[#111114] border border-white/6 rounded-xl p-4">
          <p className="text-xs text-[#71717A] mb-1">Conversions</p>
          <p className="font-mono text-xl font-semibold text-white">{conversions.toLocaleString()}</p>
          <p className="text-[10px] text-[#52525B] mt-0.5">Payments completed</p>
        </div>
        <div className="bg-[#111114] border border-white/6 rounded-xl p-4">
          <p className="text-xs text-[#71717A] mb-1">Paywall conv. rate</p>
          <p className="font-mono text-xl font-semibold text-emerald-400">{formatPercent(overallConvRate)}</p>
          <p className="text-[10px] text-[#52525B] mt-0.5">Views → payments</p>
        </div>
      </div>

      {/* Funnel */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-[#111114] border border-white/6 rounded-xl p-6 mb-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-white">Conversion funnel</h2>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#52525B]" />}
        </div>

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-10 h-10 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center mb-3">
              <BarChart2 className="w-5 h-5 text-indigo-400" />
            </div>
            <p className="text-sm font-medium text-white mb-1">No data yet</p>
            <p className="text-xs text-[#52525B] max-w-xs mb-4">
              Install the Hatch SDK in your app and publish a paywall to start seeing funnel data here.
            </p>
            <div className="flex items-center gap-3">
              <Link
                href="/paywalls"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Go to paywalls
                <ArrowRight className="w-3 h-3" />
              </Link>
              <Link
                href="/settings/project-brief"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/8 text-[#A1A1AA] hover:text-white text-xs font-medium rounded-lg border border-white/8 transition-colors"
              >
                Complete setup
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {funnel.map((step, i) => {
                const prev = i > 0 ? funnel[i - 1].count : step.count
                const dropoff = prev > 0 ? (1 - step.count / prev) * 100 : 0
                const pct = step.count / (prev || 1) * 100
                return (
                  <div key={step.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[#52525B] w-4">{i + 1}</span>
                        <span className="text-sm text-white">{step.label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {i > 0 && (
                          <div className="flex items-center gap-2">
                            {dropoff > 0 && (
                              <span className="text-xs text-red-400 flex items-center gap-1">
                                <TrendingDown className="w-3 h-3" />
                                {formatPercent(dropoff)} drop
                              </span>
                            )}
                            <span className="text-xs text-[#52525B]">
                              {formatPercent(pct)} of prev
                            </span>
                          </div>
                        )}
                        <span className="font-mono text-sm text-white w-16 text-right">{step.count.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(step.count / max) * 100}%` }}
                        transition={{ delay: i * 0.05, duration: 0.5, ease: "easeOut" }}
                        className="h-full rounded-full"
                        style={{ background: step.color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-white/6 flex items-center justify-between">
              <p className="text-sm text-[#71717A]">
                Overall conversion (views → payments):{" "}
                <span className="text-emerald-400 font-semibold">
                  {funnel[0]?.count > 0 ? formatPercent((funnel[funnel.length - 1]?.count / funnel[0].count) * 100) : "—"}
                </span>
              </p>
              <p className="text-xs text-[#52525B]">Last {dateRange} days</p>
            </div>
          </>
        )}
      </motion.div>

      {/* Revenue chart */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-[#111114] border border-white/6 rounded-xl p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Revenue</h2>
          <span className="text-xs text-[#52525B]">Last {dateRange} days</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-[200px]">
            <Loader2 className="w-4 h-4 animate-spin text-[#52525B]" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={revenueByDay} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tickFormatter={d => format(new Date(d), dateRange === 7 ? "EEE" : "MMM d")}
                tick={{ fill: "#52525B", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={xInterval}
              />
              <YAxis tickFormatter={v => formatMoney(v)} tick={{ fill: "#52525B", fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 12 }}
                formatter={(v) => [formatMoney(Number(v)), "Revenue"]}
                labelFormatter={l => format(new Date(l), "MMM d, yyyy")}
              />
              <Bar dataKey="revenue" fill="#6366F1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </motion.div>
    </div>
  )
}

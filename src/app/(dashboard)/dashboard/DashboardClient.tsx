"use client"

import { motion, AnimatePresence } from "framer-motion"
import { formatMoney, formatPercent, formatNumber } from "@/lib/utils"
import { TrendingUp, Users, Zap, DollarSign, ArrowRight, ExternalLink, Check, CreditCard, BookOpen, Radio, Layers } from "lucide-react"
import Link from "next/link"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { format, formatDistanceToNow } from "date-fns"

type Event = {
  id: string
  event_type: string
  properties: Record<string, unknown>
  created_at: string
}

type Customer = {
  id: string
  email: string | null
  subscription_status: string
  created_at: string
  plans: { name: string } | null
}

type Paywall = {
  id: string
  name: string
  views: number
  conversions: number
}

interface Checklist {
  stripe: boolean
  plan: boolean
  brief: boolean
  sdk: boolean
  paywall: boolean
}

interface Props {
  appName: string
  mrr: number
  conversions: number
  conversionRate: number
  activeSubscribers: number
  recentEvents: Event[]
  recentCustomers: Customer[]
  mrrChartData: { date: string; mrr: number }[]
  topPaywall: Paywall | null
  checklist: Checklist
  lastHeartbeat: string | null
}

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  paywall_shown:        { label: "Paywall shown",         color: "#6366F1" },
  plan_selected:        { label: "Plan selected",         color: "#8B5CF6" },
  cta_clicked:          { label: "CTA clicked",           color: "#A78BFA" },
  checkout_started:     { label: "Checkout started",      color: "#F59E0B" },
  checkout_abandoned:   { label: "Checkout abandoned",    color: "#EF4444" },
  payment_success:      { label: "New subscriber ✓",      color: "#10B981" },
  trial_started:        { label: "Trial started",         color: "#06B6D4" },
  trial_ending:         { label: "Trial ending soon",     color: "#F97316" },
  subscription_canceled: { label: "Subscription canceled", color: "#EF4444" },
  payment_failed:       { label: "Payment failed",        color: "#DC2626" },
  refund_issued:        { label: "Refund issued",         color: "#EF4444" },
  paywall_dismissed:    { label: "Paywall dismissed",     color: "#52525B" },
  billing_toggle_changed: { label: "Billing toggle",      color: "#71717A" },
  quiz_completed:       { label: "Quiz completed",        color: "#7C3AED" },
  quiz_abandoned:       { label: "Quiz abandoned",        color: "#6B7280" },
  page_view:            { label: "Page view",             color: "#3F3F46" },
}

const CHECKLIST_ITEMS = [
  { key: "stripe", label: "Connect Stripe", desc: "Accept payments via Stripe Connect", href: "/settings", icon: CreditCard },
  { key: "plan", label: "Create a plan", desc: "Define your pricing tiers", href: "/plans", icon: DollarSign },
  { key: "brief", label: "Complete project brief", desc: "Unlock AI-generated paywall copy", href: "/settings/project-brief", icon: BookOpen },
  { key: "sdk", label: "Install the SDK", desc: "Add one script tag to your app", href: "/integrate", icon: Radio },
  { key: "paywall", label: "Create a paywall", desc: "Set up your first upgrade screen", href: "/paywalls", icon: Layers },
] as const

export default function DashboardClient({
  appName, mrr, conversions, conversionRate, activeSubscribers,
  recentEvents, recentCustomers, mrrChartData, topPaywall, checklist, lastHeartbeat,
}: Props) {
  const allDone = Object.values(checklist).every(Boolean)
  const completedCount = Object.values(checklist).filter(Boolean).length
  const sdkActive = lastHeartbeat
    ? Date.now() - new Date(lastHeartbeat).getTime() < 5 * 60 * 1000 // active if heartbeat < 5min ago
    : false
  const kpis = [
    {
      label: "MRR",
      value: formatMoney(mrr),
      icon: DollarSign,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Conversions this month",
      value: String(conversions),
      icon: TrendingUp,
      color: "text-indigo-400",
      bg: "bg-indigo-500/10",
    },
    {
      label: "Conversion rate",
      value: formatPercent(conversionRate),
      icon: Zap,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
    },
    {
      label: "Active subscribers",
      value: formatNumber(activeSubscribers),
      icon: Users,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
  ]

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">{appName}</h1>
          <p className="text-sm text-[#71717A]">Here's what's happening with your monetization</p>
        </div>
        {/* SDK Status badge */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${
          sdkActive
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            : checklist.sdk
            ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
            : "bg-white/4 border-white/8 text-[#52525B]"
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${sdkActive ? "bg-emerald-400 animate-pulse" : checklist.sdk ? "bg-amber-400" : "bg-[#3F3F46]"}`} />
          {sdkActive ? "SDK active" : checklist.sdk
            ? `Last seen ${formatDistanceToNow(new Date(lastHeartbeat!), { addSuffix: true })}`
            : "SDK not installed"
          }
        </div>
      </div>

      {/* Setup Checklist */}
      <AnimatePresence>
        {!allDone && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.3 }}
            className="mb-6 bg-[#111114] border border-white/6 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Get started</h2>
                <p className="text-xs text-[#71717A] mt-0.5">{completedCount} of 5 steps completed</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-white/6 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-indigo-500 rounded-full"
                    animate={{ width: `${(completedCount / 5) * 100}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                </div>
                <span className="text-xs text-[#52525B]">{Math.round((completedCount / 5) * 100)}%</span>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {CHECKLIST_ITEMS.map(item => {
                const done = checklist[item.key]
                return (
                  <Link key={item.key} href={done ? "#" : item.href} className={`group flex flex-col items-start p-3 rounded-lg border transition-all ${
                    done
                      ? "bg-emerald-500/5 border-emerald-500/15 cursor-default"
                      : "bg-white/2 border-white/8 hover:border-indigo-500/30 hover:bg-indigo-500/5"
                  }`}>
                    <div className={`w-6 h-6 rounded-full border flex items-center justify-center mb-2 flex-shrink-0 transition-all ${
                      done
                        ? "bg-emerald-500 border-emerald-500"
                        : "bg-white/4 border-white/15 group-hover:border-indigo-500/40"
                    }`}>
                      {done
                        ? <Check className="w-3.5 h-3.5 text-white" />
                        : <item.icon className="w-3 h-3 text-[#52525B] group-hover:text-indigo-400" />
                      }
                    </div>
                    <p className={`text-xs font-medium ${done ? "text-emerald-400" : "text-[#A1A1AA] group-hover:text-white"}`}>
                      {item.label}
                    </p>
                    <p className="text-[10px] text-[#52525B] mt-0.5 leading-relaxed">{item.desc}</p>
                  </Link>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {kpis.map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-[#111114] border border-white/6 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[#71717A] font-medium">{kpi.label}</span>
              <div className={`w-7 h-7 rounded-lg ${kpi.bg} flex items-center justify-center`}>
                <kpi.icon className={`w-3.5 h-3.5 ${kpi.color}`} />
              </div>
            </div>
            <p className="font-mono text-2xl font-semibold text-white">{kpi.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* MRR Chart */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="col-span-2 bg-[#111114] border border-white/6 rounded-xl p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">MRR Growth</h2>
              <p className="text-xs text-[#71717A]">Last 90 days</p>
            </div>
            <span className="text-xs text-[#52525B]">Cumulative</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={mrrChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={d => format(new Date(d), "MMM d")}
                tick={{ fill: "#52525B", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={14}
              />
              <YAxis
                tickFormatter={v => formatMoney(v)}
                tick={{ fill: "#52525B", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{ background: "#111114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#A1A1AA" }}
                formatter={(v) => [formatMoney(Number(v)), "MRR"]}
                labelFormatter={l => format(new Date(l), "MMM d, yyyy")}
              />
              <Area
                type="monotone"
                dataKey="mrr"
                stroke="#6366F1"
                strokeWidth={2}
                fill="url(#mrrGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Live Activity */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-[#111114] border border-white/6 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-sm font-semibold text-white">Live Activity</h2>
          </div>
          <div className="space-y-2.5 overflow-y-auto max-h-[200px]">
            {recentEvents.length === 0 && (
              <p className="text-xs text-[#52525B] text-center py-6">No events yet. Integrate the SDK to see activity.</p>
            )}
            {recentEvents.map(ev => {
              const meta = EVENT_LABELS[ev.event_type] ?? { label: ev.event_type, color: "#52525B" }
              return (
                <div key={ev.id} className="flex items-center gap-2.5 py-1.5 border-b border-white/4 last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#A1A1AA] truncate">{meta.label}</p>
                    <p className="text-[10px] text-[#52525B]">
                      {new Date(ev.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Top Paywall */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-[#111114] border border-white/6 rounded-xl p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Top Paywall</h2>
            <Link href="/paywalls" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              All paywalls <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {topPaywall ? (
            <div>
              <p className="text-sm font-medium text-white mb-2">{topPaywall.name}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/3 rounded-lg p-2.5">
                  <p className="text-[10px] text-[#71717A] mb-0.5">Views</p>
                  <p className="font-mono text-sm text-white">{formatNumber(topPaywall.views)}</p>
                </div>
                <div className="bg-white/3 rounded-lg p-2.5">
                  <p className="text-[10px] text-[#71717A] mb-0.5">Conv. rate</p>
                  <p className="font-mono text-sm text-emerald-400">
                    {topPaywall.views ? formatPercent((topPaywall.conversions / topPaywall.views) * 100) : "—"}
                  </p>
                </div>
              </div>
              <Link href={`/paywalls/${topPaywall.id}`} className="mt-3 flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
                Edit paywall <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-xs text-[#52525B] mb-3">No live paywalls yet</p>
              <Link href="/paywalls" className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium">
                <Zap className="w-3 h-3" /> Create paywall
              </Link>
            </div>
          )}
        </motion.div>

        {/* Recent Customers */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="col-span-2 bg-[#111114] border border-white/6 rounded-xl p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Recent Customers</h2>
            <Link href="/customers" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              All customers <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {recentCustomers.length === 0 ? (
            <p className="text-xs text-[#52525B] text-center py-6">No subscribers yet. Publish your first paywall to get started.</p>
          ) : (
            <div className="space-y-1">
              {recentCustomers.map(c => (
                <div key={c.id} className="flex items-center gap-3 py-2 border-b border-white/4 last:border-0">
                  <div className="w-7 h-7 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-xs text-indigo-400 font-semibold flex-shrink-0">
                    {(c.email ?? "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{c.email ?? "Anonymous"}</p>
                    <p className="text-xs text-[#71717A]">{(c.plans as { name?: string } | null)?.name ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      c.subscription_status === "active" ? "bg-emerald-500/10 text-emerald-400" :
                      c.subscription_status === "trialing" ? "bg-blue-500/10 text-blue-400" :
                      "bg-white/5 text-[#71717A]"
                    }`}>
                      {c.subscription_status}
                    </span>
                    <span className="text-xs text-[#52525B]">
                      {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}

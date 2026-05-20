"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion, AnimatePresence } from "framer-motion"
import {
  Loader2, Search, Download, X, ChevronRight,
  Mail, Calendar, TrendingDown, DollarSign, Activity
} from "lucide-react"
import { formatMoney } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"

type Subscriber = {
  id: string
  email: string | null
  subscription_status: string
  ltv_cents: number
  churn_risk_score: number
  created_at: string
  last_seen_at: string | null
  plans: { id: string; name: string; price_monthly: number } | null
}

type Event = {
  id: string
  event_type: string
  created_at: string
  properties: Record<string, unknown>
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  trialing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  past_due: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  canceled: "bg-white/5 text-[#71717A] border-white/10",
  churned: "bg-red-500/10 text-red-400 border-red-500/20",
  free: "bg-white/5 text-[#52525B] border-white/6",
}

const EVENT_LABELS: Record<string, string> = {
  paywall_shown: "Saw paywall",
  plan_selected: "Selected plan",
  checkout_started: "Started checkout",
  payment_success: "Subscribed",
  trial_started: "Started trial",
  subscription_canceled: "Canceled",
  page_view: "Page view",
}

export default function CustomersPage() {
  const supabase = createClient()
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [selected, setSelected] = useState<Subscriber | null>(null)
  const [customerEvents, setCustomerEvents] = useState<Event[]>([])
  const [drawerLoading, setDrawerLoading] = useState(false)

  useEffect(() => { loadSubscribers() }, [])

  async function loadSubscribers() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
    if (!profile) return
    const { data } = await supabase
      .from("subscribers")
      .select("*, plans(id, name, price_monthly)")
      .eq("account_id", profile.account_id)
      .order("created_at", { ascending: false })
    setSubscribers(data ?? [])
    setLoading(false)
  }

  async function openDrawer(sub: Subscriber) {
    setSelected(sub)
    setDrawerLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
    if (!profile) return
    const { data: evts } = await supabase
      .from("events")
      .select("*")
      .eq("account_id", profile.account_id)
      .eq("properties->>email", sub.email ?? "")
      .order("created_at", { ascending: false })
      .limit(50)
    setCustomerEvents(evts ?? [])
    setDrawerLoading(false)
  }

  function exportCsv() {
    const headers = ["Email", "Plan", "Status", "MRR ($)", "LTV ($)", "Churn Risk", "Joined", "Last Seen"]
    const rows = filtered.map(s => [
      s.email ?? "",
      (s.plans as { name?: string } | null)?.name ?? "",
      s.subscription_status,
      s.plans?.price_monthly ? (s.plans.price_monthly / 100).toFixed(2) : "0.00",
      (s.ltv_cents / 100).toFixed(2),
      s.churn_risk_score ?? 0,
      new Date(s.created_at).toISOString().slice(0, 10),
      s.last_seen_at ? new Date(s.last_seen_at).toISOString().slice(0, 10) : "",
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "customers.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = subscribers.filter(s => {
    const matchesSearch = !search || s.email?.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === "all" || s.subscription_status === statusFilter
    return matchesSearch && matchesStatus
  })

  const activeMrr = subscribers
    .filter(s => s.subscription_status === "active")
    .reduce((sum, s) => sum + (s.plans?.price_monthly ?? 0), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-[#71717A]" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">Customers</h1>
          <p className="text-sm text-[#71717A]">
            {subscribers.length.toLocaleString()} total · {" "}
            {subscribers.filter(s => s.subscription_status === "active").length} active · {" "}
            <span className="text-emerald-400 font-mono">{formatMoney(activeMrr)}/mo MRR</span>
          </p>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/8 border border-white/10 text-[#A1A1AA] hover:text-white text-sm rounded-lg transition-all"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#52525B]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email..."
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-[#52525B] outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500/50 transition-colors"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="past_due">Past due</option>
          <option value="canceled">Canceled</option>
          <option value="churned">Churned</option>
          <option value="free">Free</option>
        </select>
        {(search || statusFilter !== "all") && (
          <button
            onClick={() => { setSearch(""); setStatusFilter("all") }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-[#71717A] hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded-xl p-12 text-center">
          <p className="text-[#71717A]">
            {search || statusFilter !== "all"
              ? "No customers match your filters"
              : "No customers yet. Publish your paywall to start collecting subscribers."}
          </p>
        </div>
      ) : (
        <div className="bg-[#111114] border border-white/6 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_110px_90px_80px_80px_100px_90px] gap-3 px-5 py-3 border-b border-white/6 text-xs text-[#52525B] font-medium">
            <span>Customer</span>
            <span>Plan</span>
            <span>Status</span>
            <span>MRR</span>
            <span>LTV</span>
            <span>Last active</span>
            <span>Joined</span>
          </div>

          {filtered.map((sub, i) => {
            const planMrr = sub.plans?.price_monthly ?? 0
            const isActive = sub.subscription_status === "active"
            return (
              <motion.div
                key={sub.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                onClick={() => openDrawer(sub)}
                className="grid grid-cols-[1fr_110px_90px_80px_80px_100px_90px] gap-3 px-5 py-3.5 border-b border-white/4 last:border-0 hover:bg-white/2 transition-colors items-center cursor-pointer group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-xs text-indigo-400 font-semibold flex-shrink-0">
                    {(sub.email ?? "?")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{sub.email ?? "Anonymous"}</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-[#52525B] opacity-0 group-hover:opacity-100 ml-auto flex-shrink-0 transition-opacity" />
                </div>
                <span className="text-sm text-[#A1A1AA] truncate">{(sub.plans as { name?: string } | null)?.name ?? "—"}</span>
                <span className={`inline-flex w-fit text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLES[sub.subscription_status] ?? STATUS_STYLES.free}`}>
                  {sub.subscription_status}
                </span>
                <span className="font-mono text-sm text-white">
                  {isActive ? formatMoney(planMrr) : "—"}
                </span>
                <span className="font-mono text-sm text-white">{formatMoney(sub.ltv_cents)}</span>
                <span className="text-xs text-[#71717A]">
                  {sub.last_seen_at
                    ? formatDistanceToNow(new Date(sub.last_seen_at), { addSuffix: true })
                    : "Never"}
                </span>
                <span className="text-xs text-[#52525B]">
                  {new Date(sub.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                </span>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Detail Drawer */}
      <AnimatePresence>
        {selected && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
              className="fixed inset-0 bg-black/50 z-40"
            />
            {/* Sheet */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
              className="fixed right-0 top-0 bottom-0 w-[420px] bg-[#0D0D0F] border-l border-white/6 z-50 flex flex-col"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/6">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-sm text-indigo-400 font-semibold">
                    {(selected.email ?? "?")[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{selected.email ?? "Anonymous"}</p>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border capitalize ${STATUS_STYLES[selected.subscription_status] ?? STATUS_STYLES.free}`}>
                      {selected.subscription_status}
                    </span>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="p-1.5 text-[#52525B] hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-white/6">
                <div className="bg-white/3 rounded-lg p-3">
                  <div className="flex items-center gap-1 mb-1">
                    <DollarSign className="w-3 h-3 text-[#71717A]" />
                    <p className="text-[10px] text-[#71717A]">MRR</p>
                  </div>
                  <p className="font-mono text-sm text-white">
                    {selected.subscription_status === "active"
                      ? formatMoney(selected.plans?.price_monthly ?? 0)
                      : "—"}
                  </p>
                </div>
                <div className="bg-white/3 rounded-lg p-3">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingDown className="w-3 h-3 text-[#71717A]" />
                    <p className="text-[10px] text-[#71717A]">LTV</p>
                  </div>
                  <p className="font-mono text-sm text-white">{formatMoney(selected.ltv_cents)}</p>
                </div>
                <div className="bg-white/3 rounded-lg p-3">
                  <div className="flex items-center gap-1 mb-1">
                    <Activity className="w-3 h-3 text-[#71717A]" />
                    <p className="text-[10px] text-[#71717A]">Churn risk</p>
                  </div>
                  <p className="font-mono text-sm" style={{
                    color: selected.churn_risk_score > 70 ? "#EF4444" : selected.churn_risk_score > 40 ? "#F59E0B" : "#10B981"
                  }}>
                    {selected.churn_risk_score ?? 0}%
                  </p>
                </div>
              </div>

              {/* Meta */}
              <div className="px-6 py-4 border-b border-white/6 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-3.5 h-3.5 text-[#52525B]" />
                  <span className="text-[#A1A1AA]">{selected.email ?? "No email"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-3.5 h-3.5 text-[#52525B]" />
                  <span className="text-[#A1A1AA]">
                    Joined {new Date(selected.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {selected.last_seen_at && (
                  <div className="flex items-center gap-2 text-sm">
                    <Activity className="w-3.5 h-3.5 text-[#52525B]" />
                    <span className="text-[#A1A1AA]">
                      Last seen {formatDistanceToNow(new Date(selected.last_seen_at), { addSuffix: true })}
                    </span>
                  </div>
                )}
                {selected.plans && (
                  <div className="flex items-center gap-2 text-sm">
                    <DollarSign className="w-3.5 h-3.5 text-[#52525B]" />
                    <span className="text-[#A1A1AA]">Plan: <span className="text-white">{(selected.plans as { name?: string } | null)?.name}</span></span>
                  </div>
                )}
              </div>

              {/* Timeline */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <h3 className="text-xs font-semibold text-[#71717A] uppercase tracking-wider mb-4">Activity timeline</h3>
                {drawerLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-4 h-4 animate-spin text-[#52525B]" />
                  </div>
                ) : customerEvents.length === 0 ? (
                  <p className="text-xs text-[#52525B] text-center py-6">No events tracked for this customer</p>
                ) : (
                  <div className="relative">
                    <div className="absolute left-2 top-0 bottom-0 w-px bg-white/6" />
                    <div className="space-y-4">
                      {customerEvents.map((ev) => (
                        <div key={ev.id} className="flex gap-3 relative pl-8">
                          <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-[#111114] border border-white/10 flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs text-white font-medium">
                              {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                            </p>
                            <p className="text-[10px] text-[#52525B] mt-0.5">
                              {new Date(ev.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

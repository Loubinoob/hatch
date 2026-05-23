"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion } from "framer-motion"
import { Plus, Eye, TrendingUp, DollarSign, Loader2, Layers, ArrowRight } from "lucide-react"
import Link from "next/link"
import { formatMoney, formatPercent, formatNumber } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

type Paywall = {
  id: string
  name: string
  status: "draft" | "live" | "archived"
  template: string
  views: number
  conversions: number
  revenue_cents: number
  updated_at: string
}

const STATUS_STYLES = {
  live: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  draft: "bg-white/5 text-[#71717A] border-white/10",
  archived: "bg-white/3 text-[#52525B] border-white/6",
}

export default function PaywallsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [paywalls, setPaywalls] = useState<Paywall[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [accountId, setAccountId] = useState<string | null>(null)

  useEffect(() => { loadPaywalls() }, [])

  async function loadPaywalls() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
    if (!profile) return
    setAccountId(profile.account_id)
    const { data } = await supabase.from("paywalls").select("*").eq("account_id", profile.account_id).order("updated_at", { ascending: false })
    const paywallList = data ?? []

    // Views: use events table as source of truth (same approach as dashboard page).
    // This is always accurate regardless of whether paywall_impressions migration has been applied.
    if (paywallList.length > 0) {
      const paywallIds = paywallList.map((p: Paywall) => p.id)
      const { data: viewRows } = await supabase
        .from("events")
        .select("paywall_id")
        .eq("account_id", profile.account_id)
        .eq("event_type", "paywall_shown")
        .in("paywall_id", paywallIds)
      if (viewRows && viewRows.length > 0) {
        // Count per paywall_id in JS
        const viewsByPaywall: Record<string, number> = {}
        for (const row of viewRows) {
          if (row.paywall_id) {
            viewsByPaywall[row.paywall_id] = (viewsByPaywall[row.paywall_id] ?? 0) + 1
          }
        }
        // Override views for every paywall (0 if no events yet)
        for (const pw of paywallList) {
          pw.views = viewsByPaywall[pw.id] ?? 0
        }
      } else {
        // No events yet — reset all views to 0 (don't trust paywalls.views column)
        for (const pw of paywallList) {
          pw.views = 0
        }
      }
    }

    setPaywalls(paywallList)
    setLoading(false)
  }

  async function createPaywall() {
    if (!accountId) return
    setCreating(true)
    const { data, error } = await supabase.from("paywalls").insert({
      account_id: accountId,
      name: "New Paywall",
      status: "draft",
      template: "classic-modal",
      headline: "Unlock the full power of your app",
      subheadline: "Join thousands of users who've upgraded",
      cta_copy: "Get started today",
    }).select().single()
    if (error) { toast.error(error.message); setCreating(false); return }

    // Auto-create the "Control" variant — baseline for all AI experiments
    await supabase.from("paywall_variants").insert({
      paywall_id: data.id,
      account_id: accountId,
      name: "Control",
      generated_by: "human",
      is_control: true,
      headline: "Unlock the full power of your app",
      subheadline: "Join thousands of users who've upgraded",
      cta_copy: "Get started today",
      accent_color: "#6366F1",
      posterior_alpha: 1,
      posterior_beta: 1,
      traffic_split: null,
    })

    router.push(`/paywalls/${data.id}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-[#71717A]" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">Paywalls</h1>
          <p className="text-sm text-[#71717A]">Design and publish conversion-optimized paywalls</p>
        </div>
        <button onClick={createPaywall} disabled={creating} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          New paywall
        </button>
      </div>

      {paywalls.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded-xl p-16 text-center">
          <div className="w-12 h-12 bg-indigo-600/10 border border-indigo-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Layers className="w-5 h-5 text-indigo-400" />
          </div>
          <h2 className="font-heading text-lg font-semibold text-white mb-2">No paywalls yet</h2>
          <p className="text-sm text-[#71717A] mb-6 max-w-sm mx-auto">Create your first paywall to start converting free users into paying subscribers</p>
          <button onClick={createPaywall} disabled={creating} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Create paywall
          </button>
        </div>
      ) : (
        <div className="bg-[#111114] border border-white/6 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_100px_80px_80px_120px_80px_40px] gap-4 px-5 py-3 border-b border-white/6 text-xs text-[#52525B] font-medium">
            <span>Name</span>
            <span>Status</span>
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> Views</span>
            <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Conv.</span>
            <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> Revenue</span>
            <span>Updated</span>
            <span />
          </div>

          {paywalls.map((pw, i) => (
            <motion.div
              key={pw.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.03 }}
            >
              <Link href={`/paywalls/${pw.id}`} className="grid grid-cols-[1fr_100px_80px_80px_120px_80px_40px] gap-4 px-5 py-4 border-b border-white/4 last:border-0 hover:bg-white/2 transition-colors items-center">
                <div>
                  <p className="text-sm font-medium text-white">{pw.name}</p>
                  <p className="text-xs text-[#52525B] capitalize">{pw.template.replace("-", " ")}</p>
                </div>
                <span className={`inline-flex w-fit text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLES[pw.status]}`}>
                  {pw.status}
                </span>
                <span className="font-mono text-sm text-[#A1A1AA]">{formatNumber(pw.views)}</span>
                <span className="font-mono text-sm text-[#A1A1AA]">
                  {pw.views > 0 ? formatPercent((pw.conversions / pw.views) * 100) : "—"}
                </span>
                <span className="font-mono text-sm text-white">{formatMoney(pw.revenue_cents)}</span>
                <span className="text-xs text-[#52525B]">
                  {new Date(pw.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-[#52525B]" />
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

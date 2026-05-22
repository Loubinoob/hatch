"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion } from "framer-motion"
import { Loader2, Copy, Check, RefreshCw, Key, User, CreditCard, AlertTriangle, Zap } from "lucide-react"
import { toast } from "sonner"
import { generateApiKey } from "@/lib/utils"

const TABS = ["Account", "Billing", "API Keys", "Danger zone"]

export default function SettingsPage() {
  const supabase = createClient()
  const [tab, setTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const [profile, setProfile] = useState<{ full_name: string; api_key: string; account_id: string } | null>(null)
  const [account, setAccount] = useState<{ name: string; app_name: string; app_url: string; platform: string } | null>(null)
  const [stripeConn, setStripeConn] = useState<{ stripe_email: string; connected_at: string } | null>(null)
  const [commissions, setCommissions] = useState<{ gross_cents: number; commission_cents: number }[]>([])

  useEffect(() => {
    loadData()
    // Show success toast if returning from Stripe OAuth
    const params = new URLSearchParams(window.location.search)
    if (params.get("stripe_connected") === "true") {
      toast.success("Stripe connecté avec succès !")
      window.history.replaceState({}, "", "/settings")
    }
    if (params.get("stripe_error")) {
      toast.error(`Erreur Stripe : ${params.get("stripe_error")}`)
      window.history.replaceState({}, "", "/settings")
    }
  }, [])

  async function loadData() {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) return
    setUser({ id: u.id, email: u.email! })

    const { data: p } = await supabase.from("users").select("full_name, api_key, account_id").eq("id", u.id).single()
    setProfile(p)

    if (p?.account_id) {
      const [{ data: acc }, { data: stripe }, { data: comm }] = await Promise.all([
        supabase.from("accounts").select("name, app_name, app_url, platform").eq("id", p.account_id).single(),
        supabase.from("stripe_connections").select("stripe_email, connected_at").eq("account_id", p.account_id).maybeSingle(),
        supabase.from("commissions").select("gross_cents, commission_cents").eq("account_id", p.account_id),
      ])
      setAccount(acc)
      setStripeConn(stripe)
      setCommissions(comm ?? [])
    }

    setLoading(false)
  }

  async function saveAccount() {
    if (!profile || !account) return
    setSaving(true)
    await supabase.from("accounts").update(account).eq("id", profile.account_id)
    await supabase.from("users").update({ full_name: profile.full_name }).eq("id", user!.id)
    toast.success("Settings saved")
    setSaving(false)
  }

  async function regenerateApiKey() {
    if (!confirm("Regenerate your API key? Your existing integration will stop working until updated.")) return
    const key = generateApiKey()
    await supabase.from("users").update({ api_key: key }).eq("id", user!.id)
    setProfile(p => p ? { ...p, api_key: key } : p)
    toast.success("New API key generated")
  }

  function copyKey() {
    if (profile?.api_key) {
      navigator.clipboard.writeText(profile.api_key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const totalGross = commissions.reduce((s, c) => s + c.gross_cents, 0)
  const totalCommission = commissions.reduce((s, c) => s + c.commission_cents, 0)

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin text-[#71717A]" /></div>
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-white mb-1">Settings</h1>
        <p className="text-sm text-[#71717A]">Manage your account, billing, and API keys</p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/6 mb-6 gap-0">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === i ? "border-indigo-500 text-white" : "border-transparent text-[#52525B] hover:text-[#A1A1AA]"
          }`}>
            {t}
          </button>
        ))}
      </div>

      {/* Account */}
      {tab === 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-[#111114] border border-white/6 rounded-xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2"><User className="w-4 h-4 text-[#71717A]" /> Profile</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#A1A1AA] mb-1.5 block">Full name</label>
                <input value={profile?.full_name ?? ""} onChange={e => setProfile(p => p ? {...p, full_name: e.target.value} : p)} className="hatch-input" />
              </div>
              <div>
                <label className="text-xs text-[#A1A1AA] mb-1.5 block">Email</label>
                <input value={user?.email ?? ""} disabled className="hatch-input opacity-50 cursor-not-allowed" />
              </div>
            </div>
          </div>

          <div className="bg-[#111114] border border-white/6 rounded-xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Zap className="w-4 h-4 text-[#71717A]" /> App</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#A1A1AA] mb-1.5 block">App name</label>
                <input value={account?.app_name ?? ""} onChange={e => setAccount(a => a ? {...a, app_name: e.target.value} : a)} className="hatch-input" />
              </div>
              <div>
                <label className="text-xs text-[#A1A1AA] mb-1.5 block">App URL</label>
                <input value={account?.app_url ?? ""} onChange={e => setAccount(a => a ? {...a, app_url: e.target.value} : a)} className="hatch-input" placeholder="https://myapp.lovable.app" />
              </div>
            </div>
            <div>
              <label className="text-xs text-[#A1A1AA] mb-1.5 block">Platform</label>
              <select value={account?.platform ?? ""} onChange={e => setAccount(a => a ? {...a, platform: e.target.value} : a)} className="hatch-input">
                {["lovable","bolt","replit","cursor","v0","other"].map(p => <option key={p} value={p} className="bg-[#111114]">{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <button onClick={saveAccount} disabled={saving} className="hatch-btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save changes
          </button>
        </motion.div>
      )}

      {/* Billing */}
      {tab === 1 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-[#111114] border border-white/6 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><CreditCard className="w-4 h-4 text-[#71717A]" /> Stripe Connection</h2>
            {stripeConn ? (
              <div>
                <div className="flex items-center gap-2 text-emerald-400 mb-3">
                  <Check className="w-4 h-4" />
                  <span className="text-sm font-medium">Connected · {stripeConn.stripe_email}</span>
                </div>
                <p className="text-xs text-[#71717A]">Connected on {new Date(stripeConn.connected_at).toLocaleDateString()}</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-[#71717A] mb-3">Connect Stripe to start accepting payments</p>
                <a href="/api/stripe/connect" className="hatch-btn-primary inline-flex">Connect Stripe →</a>
              </div>
            )}
          </div>

          <div className="bg-[#111114] border border-white/6 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-white mb-4">Hatch commission (1% of revenue)</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-white/3 rounded-lg p-4">
                <p className="text-xs text-[#71717A] mb-1">Total processed</p>
                <p className="font-mono text-xl text-white">${(totalGross / 100).toFixed(2)}</p>
              </div>
              <div className="bg-white/3 rounded-lg p-4">
                <p className="text-xs text-[#71717A] mb-1">Hatch commission</p>
                <p className="font-mono text-xl text-indigo-400">${(totalCommission / 100).toFixed(2)}</p>
              </div>
            </div>
            <p className="text-xs text-[#52525B]">Commission is deducted automatically via Stripe Connect on each transaction.</p>
          </div>
        </motion.div>
      )}

      {/* API Keys */}
      {tab === 2 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0}} className="space-y-4">
          <div className="bg-[#111114] border border-white/6 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><Key className="w-4 h-4 text-[#71717A]" /> API Key</h2>
            <p className="text-xs text-[#71717A] mb-4">Use this key to initialize the Hatch SDK in your app.</p>
            <div className="flex gap-2">
              <div className="flex-1 bg-[#0A0A0B] border border-white/6 rounded-lg px-3 py-2.5 font-mono text-sm text-indigo-300">
                {profile?.api_key ?? "—"}
              </div>
              <button onClick={copyKey} className="p-2.5 bg-white/5 hover:bg-white/8 border border-white/10 rounded-lg transition-colors">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#71717A]" />}
              </button>
            </div>
            <button onClick={regenerateApiKey} className="mt-3 flex items-center gap-2 text-xs text-[#71717A] hover:text-amber-400 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate key
            </button>
          </div>

          <div className="bg-[#111114] border border-white/6 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-white mb-3">SDK Installation</h2>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-[#71717A] mb-1.5">HTML / Lovable / Bolt / Replit</p>
                <pre className="bg-[#0A0A0B] border border-white/6 rounded-lg p-3 text-xs font-mono text-[#A1A1AA] overflow-x-auto select-all">
{`<script async src="${typeof window !== "undefined" ? window.location.origin : ""}/sdk/sdk.js"
  data-key="${profile?.api_key ?? "pk_live_..."}"></script>`}
                </pre>
                <p className="text-[11px] text-[#52525B] mt-1.5">Paste once in your app&apos;s <code className="font-mono text-[#71717A]">&lt;head&gt;</code> or custom scripts block.</p>
              </div>
              <div className="p-3 rounded-lg bg-white/3 border border-white/6">
                <p className="text-xs text-[#71717A] font-medium mb-1">React / Next.js</p>
                <p className="text-[11px] text-[#52525B]">Add the script tag above to your root layout&apos;s <code className="font-mono text-[#71717A]">&lt;head&gt;</code>. A dedicated npm package is coming soon.</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Danger zone */}
      {tab === 3 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><AlertTriangle className="w-4 h-4 text-red-400" /> Danger zone</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-red-500/10">
                <div>
                  <p className="text-sm font-medium text-white">Delete account</p>
                  <p className="text-xs text-[#71717A] mt-0.5">Permanently delete your account and all data. This cannot be undone.</p>
                </div>
                <button
                  onClick={() => toast.error("Contact support to delete your account")}
                  className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-medium rounded-lg transition-colors flex-shrink-0"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <style jsx global>{`
        .hatch-input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 12px;font-size:14px;color:white;outline:none;transition:all 0.15s;}
        .hatch-input::placeholder{color:#52525B;}
        .hatch-input:focus{border-color:rgba(99,102,241,0.5);box-shadow:0 0 0 1px rgba(99,102,241,0.3);}
        .hatch-input option{background:#111114;}
        .hatch-btn-primary{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#6366F1;color:white;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.15s;}
        .hatch-btn-primary:hover{background:#5055E8;}
      `}</style>
    </div>
  )
}

"use client"

import { useEffect, useState, use } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion } from "framer-motion"
import { Loader2, Eye, Smartphone, Monitor, Tablet, Save, Zap, ChevronLeft, Sparkles, RefreshCw, Check, BookOpen, Copy, AlertCircle } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import PaywallPreview from "@/components/paywall/PaywallPreview"

type PaywallConfig = {
  id: string
  name: string
  status: "draft" | "live" | "archived"
  template: string
  headline: string
  subheadline: string | null
  cta_copy: string
  social_proof: string | null
  show_yearly_toggle: boolean
  closeable: boolean
  plan_ids: string[]
  design: Record<string, unknown>
  views: number
  conversions: number
  revenue_cents: number
}

type Plan = {
  id: string
  name: string
  price_monthly: number
  price_yearly: number
  features: string[]
  is_popular: boolean
}

type Viewport = "desktop" | "tablet" | "mobile"

const VIEWPORTS: { key: Viewport; icon: typeof Monitor; width: number }[] = [
  { key: "desktop", icon: Monitor, width: 900 },
  { key: "tablet", icon: Tablet, width: 640 },
  { key: "mobile", icon: Smartphone, width: 375 },
]

const TABS = ["Design", "Content", "Pricing", "Triggers"]

export default function PaywallBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()
  const [paywall, setPaywall] = useState<PaywallConfig | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [viewport, setViewport] = useState<Viewport>("desktop")
  const [form, setForm] = useState<Partial<PaywallConfig>>({})
  const [briefCompleted, setBriefCompleted] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [stripeConnected, setStripeConnected] = useState(false)
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<Array<{
    emotional_driver: string
    headline: string
    subheadline: string
    cta_text: string
    body_copy: string
    tone: string
  }>>([])
  const [generatingAi, setGeneratingAi] = useState(false)
  const [appliedIdx, setAppliedIdx] = useState<number | null>(null)

  useEffect(() => { loadPaywall() }, [id])

  async function loadPaywall() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()

    const [{ data: pw }, { data: p }, { data: brief }, { data: acct }] = await Promise.all([
      supabase.from("paywalls").select("*").eq("id", id).single(),
      supabase.from("plans").select("*").eq("account_id", profile?.account_id).eq("is_active", true),
      supabase.from("project_briefs").select("completed_at").eq("account_id", profile?.account_id ?? "").maybeSingle(),
      supabase.from("accounts").select("stripe_account_id").eq("id", profile?.account_id ?? "").single(),
    ])
    setPaywall(pw)
    setForm(pw ?? {})
    setPlans(p ?? [])
    setBriefCompleted(!!brief?.completed_at)
    setApiKey(profile ? (await supabase.from("users").select("api_key").eq("id", user.id).single()).data?.api_key ?? "" : "")
    setStripeConnected(!!acct?.stripe_account_id)
    setLoading(false)
  }

  function update(key: keyof PaywallConfig, value: unknown) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase.from("paywalls").update({ ...form, updated_at: new Date().toISOString() }).eq("id", id)
    if (error) { toast.error(error.message) } else { toast.success("Saved") }
    setSaving(false)
  }

  async function generateAiCopy() {
    setGeneratingAi(true)
    setAppliedIdx(null)
    try {
      const res = await fetch("/api/ai/generate-paywall-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paywall_id: id }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Failed to generate copy")
        return
      }
      setAiSuggestions(data.variations ?? [])
      toast.success("AI copy generated!")
    } catch {
      toast.error("Failed to generate copy")
    } finally {
      setGeneratingAi(false)
    }
  }

  function applyAiVariation(idx: number) {
    const v = aiSuggestions[idx]
    if (!v) return
    update("headline", v.headline)
    update("subheadline", v.subheadline)
    update("cta_copy", v.cta_text)
    setAppliedIdx(idx)
    toast.success("Copy applied!")
  }

  function copyInstallSnippet() {
    const snippet = `<script async src="https://cdn.hatch.io/v1/sdk.js" data-key="${apiKey}"></script>`
    navigator.clipboard.writeText(snippet)
    setSnippetCopied(true)
    setTimeout(() => setSnippetCopied(false), 2000)
  }

  async function handlePublish() {
    setPublishing(true)
    const newStatus = form.status === "live" ? "draft" : "live"
    const { error } = await supabase.from("paywalls").update({ ...form, status: newStatus, updated_at: new Date().toISOString() }).eq("id", id)
    if (error) { toast.error(error.message) } else {
      toast.success(newStatus === "live" ? "Paywall published!" : "Paywall unpublished")
      update("status", newStatus)
    }
    setPublishing(false)
  }

  if (loading || !paywall) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-[#71717A]" />
      </div>
    )
  }

  const selectedPlans = plans.filter(p => form.plan_ids?.includes(p.id) ?? true)
  const hasSelectedPlans = (form.plan_ids?.length ?? 0) > 0
  const canPublish = stripeConnected && hasSelectedPlans

  return (
    <div className="flex h-screen bg-[#0A0A0B]">
      {/* Left Panel */}
      <div className="w-[300px] flex-shrink-0 border-r border-white/6 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/6 flex items-center gap-2">
          <Link href="/paywalls" className="text-[#52525B] hover:text-white transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <input
              value={form.name ?? ""}
              onChange={e => update("name", e.target.value)}
              className="bg-transparent text-sm font-semibold text-white w-full outline-none border-b border-transparent hover:border-white/10 focus:border-indigo-500 transition-colors pb-0.5"
            />
          </div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            form.status === "live" ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-[#71717A]"
          }`}>
            {form.status}
          </span>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/6">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                activeTab === i ? "text-white border-indigo-500" : "text-[#52525B] border-transparent hover:text-[#A1A1AA]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Design tab */}
          {activeTab === 0 && (
            <>
              <div>
                <label className="text-xs text-[#71717A] mb-2 block font-medium">Template</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "classic-modal", label: "Classic Modal" },
                    { key: "slide-in", label: "Slide-in" },
                    { key: "fullscreen", label: "Full Screen" },
                    { key: "bottom-sheet", label: "Bottom Sheet" },
                  ].map(t => (
                    <button
                      key={t.key}
                      onClick={() => update("template", t.key)}
                      className={`p-2.5 rounded-lg border text-xs font-medium transition-all text-left ${
                        form.template === t.key
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                          : "border-white/6 bg-white/3 text-[#71717A] hover:border-white/12 hover:text-[#A1A1AA]"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-[#71717A] mb-2 block font-medium">Accent color</label>
                <div className="flex gap-2">
                  {["#6366F1", "#8B5CF6", "#EC4899", "#10B981", "#F59E0B", "#3B82F6"].map(c => (
                    <button
                      key={c}
                      onClick={() => update("design", { ...(form.design ?? {}), accentColor: c })}
                      className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                        (form.design as Record<string, string>)?.accentColor === c ? "border-white scale-110" : "border-transparent"
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs text-[#A1A1AA]">Closeable</label>
                <button
                  onClick={() => update("closeable", !form.closeable)}
                  className={`w-9 h-5 rounded-full transition-colors relative ${form.closeable ? "bg-indigo-600" : "bg-white/10"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.closeable ? "translate-x-4.5" : "translate-x-0.5"}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs text-[#A1A1AA]">Yearly toggle</label>
                <button
                  onClick={() => update("show_yearly_toggle", !form.show_yearly_toggle)}
                  className={`w-9 h-5 rounded-full transition-colors relative ${form.show_yearly_toggle ? "bg-indigo-600" : "bg-white/10"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.show_yearly_toggle ? "translate-x-4.5" : "translate-x-0.5"}`} />
                </button>
              </div>
            </>
          )}

          {/* Content tab */}
          {activeTab === 1 && (
            <>
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Headline</label>
                <textarea
                  value={form.headline ?? ""}
                  onChange={e => update("headline", e.target.value)}
                  rows={2}
                  className="hatch-input resize-none text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Subheadline</label>
                <input
                  value={form.subheadline ?? ""}
                  onChange={e => update("subheadline", e.target.value)}
                  className="hatch-input text-sm"
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">CTA copy</label>
                <input
                  value={form.cta_copy ?? ""}
                  onChange={e => update("cta_copy", e.target.value)}
                  className="hatch-input text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Social proof</label>
                <input
                  value={form.social_proof ?? ""}
                  onChange={e => update("social_proof", e.target.value)}
                  className="hatch-input text-sm"
                  placeholder="Trusted by 1,200+ founders"
                />
              </div>

              {/* AI Suggestions */}
              <div className="pt-3 border-t border-white/6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-xs font-semibold text-white">AI Copy</span>
                  </div>
                  {aiSuggestions.length > 0 && (
                    <button
                      onClick={generateAiCopy}
                      disabled={generatingAi}
                      className="flex items-center gap-1 text-[10px] text-[#52525B] hover:text-indigo-400 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${generatingAi ? "animate-spin" : ""}`} />
                      Regenerate
                    </button>
                  )}
                </div>

                {!briefCompleted ? (
                  <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3 text-center">
                    <BookOpen className="w-4 h-4 text-amber-400 mx-auto mb-1.5" />
                    <p className="text-[11px] text-amber-400 font-medium mb-1">Brief required</p>
                    <p className="text-[10px] text-[#71717A] mb-2">Complete your Project Brief to unlock AI copy generation</p>
                    <Link href="/settings/project-brief" className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
                      Complete brief →
                    </Link>
                  </div>
                ) : aiSuggestions.length === 0 ? (
                  <button
                    onClick={generateAiCopy}
                    disabled={generatingAi}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 text-xs font-medium transition-all disabled:opacity-50"
                  >
                    {generatingAi ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5" /> Generate 3 variations</>
                    )}
                  </button>
                ) : (
                  <div className="space-y-2">
                    {aiSuggestions.map((v, i) => (
                      <div key={i} className={`rounded-lg border p-3 transition-all ${
                        appliedIdx === i
                          ? "bg-emerald-500/5 border-emerald-500/20"
                          : "bg-white/2 border-white/8"
                      }`}>
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="text-[10px] text-indigo-400 font-semibold capitalize">
                            {v.emotional_driver.replace(/_/g, " ")}
                          </p>
                          <span className="text-[9px] text-[#52525B] capitalize italic">{v.tone}</span>
                        </div>
                        <p className="text-xs font-semibold text-white mb-1 leading-snug">{v.headline}</p>
                        {v.subheadline && (
                          <p className="text-[10px] text-[#71717A] mb-2 leading-relaxed">{v.subheadline}</p>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[#52525B] font-mono">CTA: {v.cta_text}</span>
                          <button
                            onClick={() => applyAiVariation(i)}
                            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded transition-all ${
                              appliedIdx === i
                                ? "text-emerald-400"
                                : "text-indigo-400 hover:text-white hover:bg-indigo-500/20"
                            }`}
                          >
                            {appliedIdx === i ? <><Check className="w-2.5 h-2.5" /> Applied</> : "Apply"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Pricing tab */}
          {activeTab === 2 && (
            <>
              <p className="text-xs text-[#71717A]">Select which plans to show</p>
              {plans.length === 0 ? (
                <div className="border border-dashed border-white/10 rounded-lg p-4 text-center">
                  <p className="text-xs text-[#52525B] mb-2">No plans yet</p>
                  <Link href="/plans" className="text-xs text-indigo-400 hover:text-indigo-300">Create plans →</Link>
                </div>
              ) : plans.map(plan => (
                <label key={plan.id} className="flex items-center gap-3 cursor-pointer bg-white/3 border border-white/6 rounded-lg p-3 hover:border-white/10 transition-colors">
                  <input
                    type="checkbox"
                    checked={form.plan_ids?.includes(plan.id) ?? false}
                    onChange={e => {
                      const ids = form.plan_ids ?? []
                      update("plan_ids", e.target.checked ? [...ids, plan.id] : ids.filter(i => i !== plan.id))
                    }}
                    className="accent-indigo-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{plan.name}</p>
                    <p className="text-xs text-[#71717A]">${plan.price_monthly / 100}/mo</p>
                  </div>
                </label>
              ))}
            </>
          )}

          {/* Triggers tab */}
          {activeTab === 3 && (
            <div>
              <p className="text-xs text-[#71717A] mb-3">When should this paywall appear?</p>
              <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 mb-3">
                <p className="text-xs font-medium text-indigo-400 mb-1">Manual trigger (Phase 1)</p>
                <p className="text-xs text-[#71717A]">Use <code className="font-mono text-indigo-300">hatch.show('{id}')</code> to show this paywall programmatically.</p>
              </div>
              <div className="border border-dashed border-white/10 rounded-lg p-4 text-center">
                <p className="text-xs text-[#52525B]">Visual rule builder coming in Phase 2</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-white/6 space-y-2">
          {form.status !== "live" && !canPublish && (
            <div className="flex items-start gap-1.5 bg-amber-500/5 border border-amber-500/15 rounded-lg px-2.5 py-2 mb-1">
              <AlertCircle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-[10px] text-amber-400 leading-relaxed">
                {!stripeConnected && !hasSelectedPlans
                  ? "Connect Stripe and select a plan to publish"
                  : !stripeConnected
                  ? "Connect Stripe to publish"
                  : "Select at least one plan to publish"}
              </p>
            </div>
          )}
          <button
            onClick={handlePublish}
            disabled={publishing || (form.status !== "live" && !canPublish)}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              form.status === "live"
                ? "bg-white/5 border border-white/10 text-[#A1A1AA] hover:text-white"
                : canPublish
                ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                : "bg-white/5 border border-white/10 text-[#52525B] cursor-not-allowed"
            }`}
          >
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {form.status === "live" ? "Unpublish" : "Publish"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium text-[#71717A] hover:text-white bg-white/3 hover:bg-white/5 border border-white/6 transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save draft
          </button>
        </div>
      </div>

      {/* Center — Preview */}
      <div className="flex-1 flex flex-col bg-[#0A0A0B] overflow-hidden">
        {/* Viewport toolbar */}
        <div className="flex items-center justify-center gap-2 py-3 border-b border-white/6">
          {VIEWPORTS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setViewport(key)}
              className={`p-2 rounded-lg transition-colors ${viewport === key ? "bg-white/8 text-white" : "text-[#52525B] hover:text-[#A1A1AA]"}`}
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>

        {/* Preview area */}
        <div className="flex-1 flex items-center justify-center overflow-auto p-8">
          <motion.div
            animate={{ width: VIEWPORTS.find(v => v.key === viewport)!.width }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="bg-[#1a1a1e] rounded-xl border border-white/6 overflow-hidden shadow-2xl flex-shrink-0"
            style={{ height: viewport === "mobile" ? 700 : 600 }}
          >
            <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/6">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
              <div className="flex-1 bg-white/5 rounded-full h-5 mx-2 flex items-center px-3">
                <span className="text-[10px] text-[#52525B]">myapp.lovable.app</span>
              </div>
            </div>
            <div className="relative h-[calc(100%-40px)] bg-gradient-to-br from-[#1a1a2e] to-[#16213e] flex items-center justify-center">
              <PaywallPreview
                config={form as PaywallConfig}
                plans={selectedPlans.length > 0 ? selectedPlans : plans.slice(0, 3)}
                accentColor={(form.design as Record<string, string>)?.accentColor ?? "#6366F1"}
              />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Right Panel — Stats */}
      <div className="w-[220px] flex-shrink-0 border-l border-white/6 p-4">
        <h3 className="text-xs font-semibold text-[#71717A] mb-3 uppercase tracking-wide">Performance</h3>
        {form.status === "live" ? (
          <div className="space-y-3">
            <div className="bg-white/3 border border-white/6 rounded-lg p-3">
              <p className="text-[10px] text-[#71717A] mb-1">Views</p>
              <p className="font-mono text-lg text-white">{paywall.views.toLocaleString()}</p>
            </div>
            <div className="bg-white/3 border border-white/6 rounded-lg p-3">
              <p className="text-[10px] text-[#71717A] mb-1">Conversions</p>
              <p className="font-mono text-lg text-white">{paywall.conversions.toLocaleString()}</p>
            </div>
            <div className="bg-white/3 border border-white/6 rounded-lg p-3">
              <p className="text-[10px] text-[#71717A] mb-1">Conv. rate</p>
              <p className="font-mono text-lg text-emerald-400">
                {paywall.views > 0 ? `${((paywall.conversions / paywall.views) * 100).toFixed(1)}%` : "—"}
              </p>
            </div>
            <div className="bg-white/3 border border-white/6 rounded-lg p-3">
              <p className="text-[10px] text-[#71717A] mb-1">Revenue</p>
              <p className="font-mono text-lg text-white">${(paywall.revenue_cents / 100).toFixed(0)}</p>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <Eye className="w-5 h-5 text-[#52525B] mx-auto mb-2" />
            <p className="text-xs text-[#52525B]">Publish to see performance data</p>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-white/6">
          <h3 className="text-xs font-semibold text-[#71717A] mb-3 uppercase tracking-wide">Install Snippet</h3>
          <div className="relative bg-[#0A0A0B] border border-white/6 rounded-lg p-2.5 mb-2">
            <code className="text-[10px] text-indigo-300 font-mono break-all leading-relaxed block pr-6">
              {`<script async\n  src="https://cdn.hatch.io/v1/sdk.js"\n  data-key="${apiKey || "pk_…"}"\n></script>`}
            </code>
            <button
              onClick={copyInstallSnippet}
              className="absolute top-2 right-2 p-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 transition-colors"
              title="Copy snippet"
            >
              {snippetCopied
                ? <Check className="w-3 h-3 text-emerald-400" />
                : <Copy className="w-3 h-3 text-[#71717A]" />}
            </button>
          </div>

          <p className="text-[9px] text-[#52525B] mb-3">Paste once in your app's <code className="font-mono">&lt;head&gt;</code></p>

          <h3 className="text-xs font-semibold text-[#71717A] mb-2 uppercase tracking-wide">Trigger</h3>
          <div className="bg-[#0A0A0B] border border-white/6 rounded-lg p-2.5">
            <code className="text-[10px] text-indigo-300 font-mono break-all">
              hatch.show('{id}')
            </code>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .hatch-input {
          width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
          border-radius:8px;padding:8px 12px;font-size:14px;color:white;outline:none;transition:all 0.15s;
        }
        .hatch-input::placeholder{color:#52525B;}
        .hatch-input:focus{border-color:rgba(99,102,241,0.5);box-shadow:0 0 0 1px rgba(99,102,241,0.3);}
      `}</style>
    </div>
  )
}

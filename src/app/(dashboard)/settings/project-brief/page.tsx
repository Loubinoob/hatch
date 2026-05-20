"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion, AnimatePresence } from "framer-motion"
import {
  Loader2, BookOpen, Sparkles, Check, Globe, FileText,
  Target, Users, Zap, Heart, Trophy, DollarSign, Wand2, AlertCircle, X
} from "lucide-react"
import { toast } from "sonner"

const CATEGORIES = [
  { value: "saas", label: "SaaS" },
  { value: "productivity", label: "Productivity" },
  { value: "developer-tools", label: "Developer Tools" },
  { value: "ai-tools", label: "AI Tools" },
  { value: "design", label: "Design" },
  { value: "marketing", label: "Marketing" },
  { value: "finance", label: "Finance" },
  { value: "education", label: "Education" },
  { value: "other", label: "Other" },
]

const TONES = [
  { value: "professional", label: "Professional", desc: "Trustworthy & authoritative" },
  { value: "friendly", label: "Friendly", desc: "Warm & approachable" },
  { value: "bold", label: "Bold", desc: "Confident & direct" },
  { value: "minimal", label: "Minimal", desc: "Clean & simple" },
  { value: "playful", label: "Playful", desc: "Fun & engaging" },
  { value: "urgent", label: "Urgent", desc: "FOMO-driven & time-sensitive" },
]

const EMOTIONAL_DRIVERS = [
  { value: "fear_of_missing_out", label: "Fear of Missing Out", icon: "🔥" },
  { value: "desire_for_status", label: "Desire for Status", icon: "👑" },
  { value: "productivity_gain", label: "Productivity Gain", icon: "⚡" },
  { value: "cost_savings", label: "Cost Savings", icon: "💰" },
  { value: "competitive_edge", label: "Competitive Edge", icon: "🏆" },
  { value: "peace_of_mind", label: "Peace of Mind", icon: "🧘" },
  { value: "social_proof", label: "Social Proof", icon: "🤝" },
  { value: "exclusivity", label: "Exclusivity / VIP", icon: "💎" },
]

interface Brief {
  app_description: string
  app_category: string
  icp_description: string
  core_problem: string
  emotional_drivers: string[]
  key_benefits: string[]
  competitors: string[]
  price_anchor: string
  tone_of_voice: string
  completed_at?: string | null
}

const EMPTY_BRIEF: Brief = {
  app_description: "",
  app_category: "",
  icp_description: "",
  core_problem: "",
  emotional_drivers: [],
  key_benefits: ["", "", ""],
  competitors: [""],
  price_anchor: "",
  tone_of_voice: "",
}

function completionScore(brief: Brief): number {
  const fields = [
    brief.app_description,
    brief.app_category,
    brief.icp_description,
    brief.core_problem,
    brief.emotional_drivers.length > 0 ? "ok" : "",
    brief.key_benefits.filter(Boolean).length > 0 ? "ok" : "",
    brief.price_anchor,
    brief.tone_of_voice,
  ]
  return Math.round((fields.filter(Boolean).length / fields.length) * 100)
}

export default function ProjectBriefPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [brief, setBrief] = useState<Brief>(EMPTY_BRIEF)
  const [existingId, setExistingId] = useState<string | null>(null)
  const [appName, setAppName] = useState("")

  // Auto-fill state
  const [analyzeMode, setAnalyzeMode] = useState<"url" | "paste">("url")
  const [analyzeUrl, setAnalyzeUrl] = useState("")
  const [pasteText, setPasteText] = useState("")
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState("")
  const [aiFields, setAiFields] = useState<Set<string>>(new Set())
  const [autoSource, setAutoSource] = useState<"url" | "paste" | null>(null)
  const [confidence, setConfidence] = useState<"high" | "medium" | "low" | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from("users").select("account_id").eq("id", user.id).single()

    if (!profile?.account_id) { setLoading(false); return }
    setAccountId(profile.account_id)

    const [{ data: acc }, { data: existingBrief }] = await Promise.all([
      supabase.from("accounts").select("app_name, app_url").eq("id", profile.account_id).single(),
      supabase.from("project_briefs").select("*").eq("account_id", profile.account_id).maybeSingle(),
    ])

    setAppName(acc?.app_name ?? "Your app")
    if (acc?.app_url) setAnalyzeUrl(acc.app_url)

    if (existingBrief) {
      setExistingId(existingBrief.id)
      setBrief({
        app_description: existingBrief.app_description ?? "",
        app_category: existingBrief.app_category ?? "",
        icp_description: existingBrief.icp_description ?? "",
        core_problem: existingBrief.core_problem ?? "",
        emotional_drivers: existingBrief.emotional_drivers ?? [],
        key_benefits: existingBrief.key_benefits?.length ? existingBrief.key_benefits : ["", "", ""],
        competitors: existingBrief.competitors?.length ? existingBrief.competitors : [""],
        price_anchor: existingBrief.price_anchor ?? "",
        tone_of_voice: existingBrief.tone_of_voice ?? "",
        completed_at: existingBrief.completed_at,
      })
      if (existingBrief.auto_generated_source) {
        setAutoSource(existingBrief.auto_generated_source)
      }
    }

    setLoading(false)
  }

  async function analyzeApp() {
    setAnalyzing(true)
    setAnalyzeError("")
    setConfidence(null)

    try {
      const body = analyzeMode === "url"
        ? { url: analyzeUrl }
        : { paste: pasteText }

      const res = await fetch("/api/ai/analyze-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        setAnalyzeError(data.error ?? "Analysis failed")
        return
      }

      const b = data.brief as Record<string, unknown>
      const filled = new Set<string>()

      // Apply fields that came back non-empty
      setBrief(prev => {
        const next = { ...prev }
        if (b.app_description) { next.app_description = b.app_description as string; filled.add("app_description") }
        if (b.app_category) { next.app_category = b.app_category as string; filled.add("app_category") }
        if (b.icp_description) { next.icp_description = b.icp_description as string; filled.add("icp_description") }
        if (b.core_problem) { next.core_problem = b.core_problem as string; filled.add("core_problem") }
        if (Array.isArray(b.emotional_drivers) && b.emotional_drivers.length > 0) {
          next.emotional_drivers = b.emotional_drivers as string[]
          filled.add("emotional_drivers")
        }
        if (Array.isArray(b.key_benefits) && b.key_benefits.length > 0) {
          next.key_benefits = [...b.key_benefits as string[], "", ""].slice(0, Math.max(3, (b.key_benefits as string[]).length))
          filled.add("key_benefits")
        }
        if (Array.isArray(b.competitors) && b.competitors.length > 0) {
          next.competitors = b.competitors as string[]
          filled.add("competitors")
        }
        if (b.price_anchor) { next.price_anchor = b.price_anchor as string; filled.add("price_anchor") }
        if (b.tone_of_voice) { next.tone_of_voice = b.tone_of_voice as string; filled.add("tone_of_voice") }
        return next
      })

      setAiFields(filled)
      setAutoSource(data.source)
      setConfidence(b.confidence as "high" | "medium" | "low" ?? "medium")

      toast.success(`Brief auto-filled from your ${data.source === "url" ? "app URL" : "description"}! Review and edit anything.`)
    } catch {
      setAnalyzeError("Something went wrong. Please try again.")
    } finally {
      setAnalyzing(false)
    }
  }

  async function saveBrief(markComplete = false) {
    if (!accountId) return
    setSaving(true)

    const payload: Record<string, unknown> = {
      account_id: accountId,
      app_description: brief.app_description,
      app_category: brief.app_category || null,
      icp_description: brief.icp_description,
      core_problem: brief.core_problem,
      emotional_drivers: brief.emotional_drivers,
      key_benefits: brief.key_benefits.filter(Boolean),
      competitors: brief.competitors.filter(Boolean),
      price_anchor: brief.price_anchor,
      tone_of_voice: brief.tone_of_voice || null,
      completed_at: markComplete ? new Date().toISOString() : (brief.completed_at ?? null),
    }

    if (autoSource) {
      payload.auto_generated_at = new Date().toISOString()
      payload.auto_generated_source = autoSource
    }

    let error
    if (existingId) {
      const res = await supabase.from("project_briefs").update(payload).eq("id", existingId)
      error = res.error
    } else {
      const res = await supabase.from("project_briefs").insert(payload).select("id").single()
      error = res.error
      if (!error && res.data) setExistingId(res.data.id)
    }

    if (error) {
      toast.error(error.message)
    } else {
      if (markComplete) setBrief(b => ({ ...b, completed_at: new Date().toISOString() }))
      toast.success(markComplete ? "Brief completed! AI copy generation is now unlocked." : "Brief saved")
    }
    setSaving(false)
  }

  function toggleDriver(driver: string) {
    setBrief(b => ({
      ...b,
      emotional_drivers: b.emotional_drivers.includes(driver)
        ? b.emotional_drivers.filter(d => d !== driver)
        : [...b.emotional_drivers, driver],
    }))
    setAiFields(f => { const n = new Set(f); n.delete("emotional_drivers"); return n })
  }

  function updateBenefit(i: number, val: string) {
    const next = [...brief.key_benefits]; next[i] = val
    setBrief(b => ({ ...b, key_benefits: next }))
    setAiFields(f => { const n = new Set(f); n.delete("key_benefits"); return n })
  }

  function updateCompetitor(i: number, val: string) {
    const next = [...brief.competitors]; next[i] = val
    setBrief(b => ({ ...b, competitors: next }))
    setAiFields(f => { const n = new Set(f); n.delete("competitors"); return n })
  }

  const score = completionScore(brief)
  const isComplete = !!brief.completed_at

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-[#71717A]" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-5 h-5 text-indigo-400" />
            <h1 className="font-heading text-2xl font-semibold text-white">Project Brief</h1>
            {isComplete && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-full">
                <Check className="w-3 h-3" /> Complete
              </span>
            )}
          </div>
          <p className="text-sm text-[#71717A] max-w-lg">
            Help Claude understand your app so it can generate high-converting paywall copy tailored to your audience.
          </p>
        </div>
        {/* Completion ring */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0 ml-4">
          <div className="relative w-14 h-14">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
              <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
              <circle cx="28" cy="28" r="22" fill="none"
                stroke={score === 100 ? "#10b981" : "#6366f1"} strokeWidth="4"
                strokeDasharray={`${2 * Math.PI * 22}`}
                strokeDashoffset={`${2 * Math.PI * 22 * (1 - score / 100)}`}
                strokeLinecap="round" className="transition-all duration-700"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">{score}%</span>
          </div>
          <span className="text-[10px] text-[#52525B]">Complete</span>
        </div>
      </div>

      {/* ─── AI Auto-Fill Block ─────────────────────────────────────────────── */}
      <div className="mb-6 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border border-indigo-500/20 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Wand2 className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">AI Auto-Fill</h2>
          <span className="text-[10px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded-full font-medium">Beta</span>
        </div>
        <p className="text-xs text-[#A1A1AA] mb-4">
          Let Claude analyze your app and fill out this form automatically. You can edit everything after.
        </p>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5 w-fit mb-4">
          <button
            onClick={() => setAnalyzeMode("url")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              analyzeMode === "url" ? "bg-white/12 text-white" : "text-[#71717A] hover:text-[#A1A1AA]"
            }`}
          >
            <Globe className="w-3 h-3" /> App URL
          </button>
          <button
            onClick={() => setAnalyzeMode("paste")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              analyzeMode === "paste" ? "bg-white/12 text-white" : "text-[#71717A] hover:text-[#A1A1AA]"
            }`}
          >
            <FileText className="w-3 h-3" /> Paste description
          </button>
        </div>

        {analyzeMode === "url" ? (
          <div className="flex gap-2">
            <input
              value={analyzeUrl}
              onChange={e => setAnalyzeUrl(e.target.value)}
              placeholder="https://myapp.lovable.app"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-[#3F3F46] outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
            />
            <button
              onClick={analyzeApp}
              disabled={analyzing || !analyzeUrl.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all flex-shrink-0"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {analyzing ? "Analyzing…" : "Analyze app"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              rows={4}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="My app helps solo founders and small teams to [what it does]. It's different because [key differentiator]. Our users typically [what they're trying to achieve]…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-[#3F3F46] outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all resize-none leading-relaxed"
            />
            <button
              onClick={analyzeApp}
              disabled={analyzing || !pasteText.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {analyzing ? "Generating brief…" : "Generate brief"}
            </button>
          </div>
        )}

        {/* Error */}
        <AnimatePresence>
          {analyzeError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"
            >
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{analyzeError}</p>
              <button onClick={() => setAnalyzeError("")} className="ml-auto text-[#52525B] hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success banner */}
        <AnimatePresence>
          {aiFields.size > 0 && !analyzeError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5"
            >
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="text-xs text-emerald-300">
                <strong>{aiFields.size} fields</strong> filled by AI
                {confidence && <span className="text-emerald-400/70 ml-1">· {confidence} confidence</span>}
                {" "}— fields marked <span className="px-1 py-0.5 bg-violet-500/20 text-violet-300 rounded text-[10px] font-mono">AI</span> below. Edit anything before saving.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main form */}
        <div className="col-span-2 space-y-5">

          {/* About your app */}
          <Section title="About your app" icon={<Zap className="w-4 h-4 text-indigo-400" />}>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="field-label mb-0">What does {appName} do? <span className="text-red-400">*</span></label>
                {aiFields.has("app_description") && <AiBadge />}
              </div>
              <textarea
                rows={3}
                value={brief.app_description}
                onChange={e => { setBrief(b => ({ ...b, app_description: e.target.value })); setAiFields(f => { const n = new Set(f); n.delete("app_description"); return n }) }}
                className={`hatch-textarea ${aiFields.has("app_description") ? "border-violet-500/30 bg-violet-500/5" : ""}`}
                placeholder={`${appName} is a tool that helps [target users] to [core function] so they can [outcome].`}
              />
              <p className="text-xs text-[#52525B] mt-1">Be specific. This is the foundation for all AI-generated copy.</p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="field-label mb-0">Category</label>
                {aiFields.has("app_category") && <AiBadge />}
              </div>
              <select
                value={brief.app_category}
                onChange={e => { setBrief(b => ({ ...b, app_category: e.target.value })); setAiFields(f => { const n = new Set(f); n.delete("app_category"); return n }) }}
                className={`hatch-input ${aiFields.has("app_category") ? "border-violet-500/30 bg-violet-500/5" : ""}`}
              >
                <option value="">Select a category…</option>
                {CATEGORIES.map(c => <option key={c.value} value={c.value} className="bg-[#111114]">{c.label}</option>)}
              </select>
            </div>
          </Section>

          {/* Target audience */}
          <Section title="Target audience" icon={<Users className="w-4 h-4 text-blue-400" />}>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="field-label mb-0">Ideal Customer Profile (ICP) <span className="text-red-400">*</span></label>
                {aiFields.has("icp_description") && <AiBadge />}
              </div>
              <textarea
                rows={2}
                value={brief.icp_description}
                onChange={e => { setBrief(b => ({ ...b, icp_description: e.target.value })); setAiFields(f => { const n = new Set(f); n.delete("icp_description"); return n }) }}
                className={`hatch-textarea ${aiFields.has("icp_description") ? "border-violet-500/30 bg-violet-500/5" : ""}`}
                placeholder="Solo founders who build with Lovable or Bolt and want to monetize without writing backend code."
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="field-label mb-0">Core problem you solve <span className="text-red-400">*</span></label>
                {aiFields.has("core_problem") && <AiBadge />}
              </div>
              <textarea
                rows={2}
                value={brief.core_problem}
                onChange={e => { setBrief(b => ({ ...b, core_problem: e.target.value })); setAiFields(f => { const n = new Set(f); n.delete("core_problem"); return n }) }}
                className={`hatch-textarea ${aiFields.has("core_problem") ? "border-violet-500/30 bg-violet-500/5" : ""}`}
                placeholder="Adding a paywall requires backend knowledge most vibe-coders don't have."
              />
            </div>
          </Section>

          {/* Emotional drivers */}
          <Section title="Emotional drivers" icon={<Heart className="w-4 h-4 text-pink-400" />}>
            <div className="flex items-center gap-2 -mt-2 mb-3">
              <p className="text-xs text-[#71717A]">What motivates your users to upgrade?</p>
              {aiFields.has("emotional_drivers") && <AiBadge />}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {EMOTIONAL_DRIVERS.map(d => {
                const selected = brief.emotional_drivers.includes(d.value)
                return (
                  <button key={d.value} type="button" onClick={() => toggleDriver(d.value)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm font-medium text-left transition-all ${
                      selected
                        ? "bg-indigo-500/15 border-indigo-500/40 text-white"
                        : "bg-white/2 border-white/8 text-[#71717A] hover:border-white/16 hover:text-[#A1A1AA]"
                    }`}
                  >
                    <span className="text-base">{d.icon}</span>
                    <span>{d.label}</span>
                    {selected && <Check className="w-3.5 h-3.5 ml-auto text-indigo-400" />}
                  </button>
                )
              })}
            </div>
          </Section>

          {/* Key benefits */}
          <Section title="Key benefits" icon={<Trophy className="w-4 h-4 text-amber-400" />}>
            <div className="flex items-center gap-2 -mt-2 mb-3">
              <p className="text-xs text-[#71717A]">Top 3 reasons users pay. Be concrete — avoid generic claims.</p>
              {aiFields.has("key_benefits") && <AiBadge />}
            </div>
            <div className="space-y-2">
              {brief.key_benefits.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-[#52525B] w-4 flex-shrink-0">{i + 1}.</span>
                  <input value={b} onChange={e => updateBenefit(i, e.target.value)}
                    className={`hatch-input flex-1 ${aiFields.has("key_benefits") && b ? "border-violet-500/30 bg-violet-500/5" : ""}`}
                    placeholder={["Launch a paywall in under 5 minutes", "No backend or Stripe setup required", "Works with any AI-built app"][i] ?? "Another benefit"}
                  />
                </div>
              ))}
              {brief.key_benefits.length < 5 && (
                <button type="button" onClick={() => setBrief(b => ({ ...b, key_benefits: [...b.key_benefits, ""] }))}
                  className="text-xs text-[#52525B] hover:text-indigo-400 transition-colors">
                  + Add benefit
                </button>
              )}
            </div>
          </Section>

          {/* Positioning */}
          <Section title="Pricing & positioning" icon={<DollarSign className="w-4 h-4 text-emerald-400" />}>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="field-label mb-0">Price anchor</label>
                {aiFields.has("price_anchor") && <AiBadge />}
              </div>
              <input value={brief.price_anchor}
                onChange={e => { setBrief(b => ({ ...b, price_anchor: e.target.value })); setAiFields(f => { const n = new Set(f); n.delete("price_anchor"); return n }) }}
                className={`hatch-input ${aiFields.has("price_anchor") ? "border-violet-500/30 bg-violet-500/5" : ""}`}
                placeholder="Less than your morning coffee — and it makes you money instead"
              />
              <p className="text-xs text-[#52525B] mt-1">How should users think about the cost vs. value?</p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="field-label mb-0">Competitors / alternatives</label>
                {aiFields.has("competitors") && <AiBadge />}
              </div>
              <div className="space-y-2">
                {brief.competitors.map((c, i) => (
                  <input key={i} value={c} onChange={e => updateCompetitor(i, e.target.value)}
                    className={`hatch-input ${aiFields.has("competitors") && c ? "border-violet-500/30 bg-violet-500/5" : ""}`}
                    placeholder={["Stripe Billing", "Lemon Squeezy", "Gumroad"][i] ?? "Alternative"}
                  />
                ))}
                {brief.competitors.length < 4 && (
                  <button type="button" onClick={() => setBrief(b => ({ ...b, competitors: [...b.competitors, ""] }))}
                    className="text-xs text-[#52525B] hover:text-indigo-400 transition-colors">
                    + Add competitor
                  </button>
                )}
              </div>
            </div>
          </Section>

          {/* Tone */}
          <Section title="Tone of voice" icon={<Target className="w-4 h-4 text-violet-400" />}>
            {aiFields.has("tone_of_voice") && (
              <div className="flex items-center gap-2 -mt-2 mb-2"><AiBadge /></div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {TONES.map(t => {
                const selected = brief.tone_of_voice === t.value
                return (
                  <button key={t.value} type="button"
                    onClick={() => { setBrief(b => ({ ...b, tone_of_voice: t.value })); setAiFields(f => { const n = new Set(f); n.delete("tone_of_voice"); return n }) }}
                    className={`flex flex-col items-start px-3 py-3 rounded-lg border text-left transition-all ${
                      selected
                        ? `bg-violet-500/15 border-violet-500/40 text-white ${aiFields.has("tone_of_voice") ? "ring-1 ring-violet-400/30" : ""}`
                        : "bg-white/2 border-white/8 text-[#71717A] hover:border-white/16"
                    }`}
                  >
                    <span className={`text-sm font-medium ${selected ? "text-white" : ""}`}>{t.label}</span>
                    <span className="text-[11px] text-[#52525B] mt-0.5">{t.desc}</span>
                  </button>
                )
              })}
            </div>
          </Section>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button onClick={() => saveBrief(false)} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/8 border border-white/10 text-white text-sm font-medium rounded-lg transition-all">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save draft
            </button>
            <button onClick={() => saveBrief(true)} disabled={saving || score < 50}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isComplete ? "Update & re-complete" : "Complete & unlock AI copy"}
            </button>
            {score < 50 && <span className="text-xs text-[#52525B]">Fill {50 - score}% more to complete</span>}
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          <div className="sticky top-6">
            <div className="bg-[#111114] border border-white/6 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">AI Preview</h3>
              </div>
              {isComplete ? (
                <div className="space-y-3">
                  <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
                    <p className="text-xs text-indigo-300 font-medium mb-1">Sample headline</p>
                    <p className="text-sm text-white font-semibold">
                      {brief.emotional_drivers.includes("fear_of_missing_out")
                        ? `Don't let your users leave without converting`
                        : brief.emotional_drivers.includes("productivity_gain")
                        ? `Ship your monetization in 5 minutes flat`
                        : `The easiest way to monetize ${appName}`}
                    </p>
                  </div>
                  <div className="bg-white/2 border border-white/6 rounded-lg p-3">
                    <p className="text-xs text-[#71717A] font-medium mb-1">Sample subheadline</p>
                    <p className="text-xs text-[#A1A1AA]">
                      {brief.icp_description
                        ? `Built for ${brief.icp_description.split(" ").slice(0, 6).join(" ")}…`
                        : "Add context above to see a preview"}
                    </p>
                  </div>
                  <p className="text-xs text-[#52525B]">Full AI copy in the Paywall Builder → Content tab.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {[
                    ["app_description", "App description"],
                    ["icp_description", "Target audience"],
                    ["emotional_drivers", "Emotional drivers"],
                    ["key_benefits", "Key benefits"],
                    ["tone_of_voice", "Tone of voice"],
                  ].map(([key, label]) => {
                    const done = key === "emotional_drivers"
                      ? brief.emotional_drivers.length > 0
                      : key === "key_benefits"
                      ? brief.key_benefits.filter(Boolean).length > 0
                      : !!brief[key as keyof Brief]
                    return (
                      <div key={key} className="flex items-center gap-2 text-xs text-[#71717A]">
                        <span className={done ? "text-emerald-400" : "text-[#3F3F46]"}>●</span>
                        {label}
                        {done && aiFields.has(key) && <AiBadge />}
                      </div>
                    )
                  })}
                  <div className="mt-3 pt-3 border-t border-white/6">
                    <p className="text-xs text-[#52525B]">Complete your brief to unlock AI-generated paywall copy.</p>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 bg-amber-500/5 border border-amber-500/15 rounded-xl p-4">
              <p className="text-xs font-semibold text-amber-400 mb-2">Pro tip</p>
              <p className="text-xs text-[#71717A] leading-relaxed">
                The more specific your ICP and emotional drivers, the more persuasive the AI-generated copy. Generic descriptions produce generic copy.
              </p>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .field-label { display:block; font-size:12px; color:#A1A1AA; margin-bottom:6px; }
        .hatch-input { width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:8px 12px; font-size:14px; color:white; outline:none; transition:all 0.15s; }
        .hatch-input:focus { border-color:rgba(99,102,241,0.5); box-shadow:0 0 0 1px rgba(99,102,241,0.3); }
        .hatch-input option { background:#111114; }
        .hatch-textarea { width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:10px 12px; font-size:14px; color:white; outline:none; transition:all 0.15s; resize:vertical; line-height:1.5; }
        .hatch-textarea:focus { border-color:rgba(99,102,241,0.5); box-shadow:0 0 0 1px rgba(99,102,241,0.3); }
        .hatch-textarea::placeholder, .hatch-input::placeholder { color:#3F3F46; }
      `}</style>
    </div>
  )
}

function AiBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-violet-500/20 border border-violet-500/30 text-violet-300 text-[10px] font-semibold rounded leading-none">
      <Sparkles className="w-2.5 h-2.5" /> AI
    </span>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#111114] border border-white/6 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2">{icon}{title}</h2>
      {children}
    </div>
  )
}

"use client"

import { useEffect, useState, use } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion } from "framer-motion"
import {
  Loader2, Eye, Smartphone, Monitor, Tablet, Save, Zap, ChevronLeft,
  Sparkles, RefreshCw, Check, BookOpen, Copy, AlertCircle, Brain,
  Archive, BarChart2, Clock, Activity, Lightbulb, Plus, Trash2, Globe, Code2,
} from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import PaywallPreview from "@/components/paywall/PaywallPreview"
import { getSdkScriptUrl } from "@/lib/sdk-url"

type PaywallConfig = {
  id: string
  name: string
  status: "draft" | "live" | "archived"
  template: string
  headline: string
  subheadline: string | null
  cta_copy: string
  social_proof: string | null
  social_proof_type: "text" | "stars" | "user_count" | "none"
  show_yearly_toggle: boolean
  closeable: boolean
  plan_ids: string[]
  design: Record<string, unknown>
  views: number
  conversions: number
  revenue_cents: number
  // V2 — Content
  body_copy: string | null
  footer_text: string | null
  guarantee_text: string | null
  urgency_text: string | null
  urgency_end_date: string | null
  show_countdown: boolean
  trust_badges: string[]
  // V2 — Pricing
  yearly_discount_percent: number
  currency: string
  show_trial_in_cta: boolean
  // V2 — Design
  font_family: "system" | "serif" | "mono"
  button_shape: "rounded" | "pill" | "square"
  overlay_opacity: number
  animation_style: "slide" | "fade" | "zoom" | "none"
  // V2 — Triggers
  trigger_config: {
    exit_intent?: boolean
    time_delay?: number | null
    scroll_depth?: number | null
    page_count?: number | null
    frequency?: "always" | "once" | "daily" | "weekly" | "monthly"
    cooldown_hours?: number
  }
  // V2 — Locale
  locale: string
  localizations: Record<string, Record<string, string>>
  auto_detect_locale: boolean
  // V2 — Advanced
  custom_css: string | null
  success_redirect_url: string | null
  hide_powered_by: boolean
  // V3 — Chameleon
  theme_mode: "auto" | "manual"
  adapt_font: boolean
  adapt_colors: boolean
  adapt_radius: boolean
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

const TABS = ["Design", "Content", "Pricing", "Quiz", "Triggers", "Languages", "Advanced", "AI"]

const LOCALES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
]

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "BRL"]

type Variant = {
  id: string
  name: string
  headline: string | null
  subheadline: string | null
  cta_copy: string | null
  body_copy: string | null
  accent_color: string | null
  views: number
  conversions: number
  posterior_alpha: number
  posterior_beta: number
  generated_by: "human" | "ai"
  hypothesis: string | null
  is_control: boolean
  archived_at: string | null
}

type AgentRun = {
  id: string
  run_type: "generation" | "reflection" | "manual_trigger"
  status: "pending" | "running" | "succeeded" | "failed"
  reasoning: string | null
  output_summary: Record<string, unknown> | null
  created_at: string
}

type AgentInsight = {
  id: string
  insight: string
  category: string
  importance: number
  evidence: Record<string, unknown>
  generated_at: string
}

type QuizOption = { value: string; label: string }
type QuizQuestion = { id: string; question: string; type: "single_choice"; options: QuizOption[] }
type QuizConfig = {
  id?: string
  is_active: boolean
  trigger_mode: "before_paywall" | "optional" | "disabled"
  questions: QuizQuestion[]
  completion_message: string
}

const DEFAULT_TRIGGER_CONFIG = {
  exit_intent: false,
  time_delay: null,
  scroll_depth: null,
  page_count: null,
  frequency: "once" as const,
  cooldown_hours: 24,
}

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
  // AI Optimizer state
  const [variants, setVariants] = useState<Variant[]>([])
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([])
  const [insights, setInsights] = useState<AgentInsight[]>([])
  const [agentLoading, setAgentLoading] = useState(false)
  const [optimizerLoaded, setOptimizerLoaded] = useState(false)
  // AI copy state
  const [aiSuggestions, setAiSuggestions] = useState<Array<{
    emotional_driver: string
    headline: string
    subheadline: string
    cta_text: string
    body_copy: string
    guarantee_text?: string
    urgency_text?: string
    trust_badges?: string[]
    tone: string
  }>>([])
  const [generatingAi, setGeneratingAi] = useState(false)
  const [appliedIdx, setAppliedIdx] = useState<number | null>(null)
  // Trust badges editor
  const [newBadge, setNewBadge] = useState("")
  // Localization editor
  const [activeLang, setActiveLang] = useState<string | null>(null)
  // Quiz state
  const [quiz, setQuiz] = useState<QuizConfig>({
    is_active: false,
    trigger_mode: "before_paywall",
    questions: [],
    completion_message: "Great — finding your perfect plan…",
  })
  const [quizLoaded, setQuizLoaded] = useState(false)
  const [generatingQuiz, setGeneratingQuiz] = useState(false)
  const [savingQuiz, setSavingQuiz] = useState(false)
  const [editingQuestionIdx, setEditingQuestionIdx] = useState<number | null>(null)

  useEffect(() => { loadPaywall() }, [id])
  useEffect(() => { if (activeTab === 7) loadOptimizer() }, [activeTab])
  useEffect(() => { if (activeTab === 3 && !quizLoaded) loadQuiz() }, [activeTab])

  async function loadPaywall() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()

    const [{ data: pw }, { data: p }, { data: brief }, { data: sc }] = await Promise.all([
      supabase.from("paywalls").select("*").eq("id", id).single(),
      supabase.from("plans").select("*").eq("account_id", profile?.account_id).eq("is_active", true),
      supabase.from("project_briefs").select("completed_at").eq("account_id", profile?.account_id ?? "").maybeSingle(),
      supabase.from("stripe_connections").select("id").eq("account_id", profile?.account_id ?? "").maybeSingle(),
    ])
    setPaywall(pw)
    setForm({
      ...pw,
      trigger_config: pw?.trigger_config ?? DEFAULT_TRIGGER_CONFIG,
      trust_badges: pw?.trust_badges ?? [],
      localizations: pw?.localizations ?? {},
    })
    setPlans(p ?? [])
    setBriefCompleted(!!brief?.completed_at)
    setApiKey(profile ? (await supabase.from("users").select("api_key").eq("id", user.id).single()).data?.api_key ?? "" : "")
    setStripeConnected(!!sc)
    setLoading(false)
  }

  async function refreshPublishStatus() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
    if (!profile) return
    const [{ data: sc }, { data: p }] = await Promise.all([
      supabase.from("stripe_connections").select("id").eq("account_id", profile.account_id).maybeSingle(),
      supabase.from("plans").select("*").eq("account_id", profile.account_id).eq("is_active", true),
    ])
    setStripeConnected(!!sc)
    setPlans(p ?? [])
  }

  async function loadOptimizer() {
    if (optimizerLoaded) return
    const [{ data: v }, { data: r }, { data: ins }] = await Promise.all([
      supabase.from("paywall_variants").select("*").eq("paywall_id", id).is("archived_at", null).order("created_at"),
      supabase.from("agent_runs").select("*").eq("paywall_id", id).order("created_at", { ascending: false }).limit(30),
      supabase.from("agent_insights").select("*").eq("paywall_id", id).order("importance", { ascending: false }).order("generated_at", { ascending: false }).limit(20),
    ])
    setVariants((v ?? []) as Variant[])
    setAgentRuns((r ?? []) as AgentRun[])
    setInsights((ins ?? []) as AgentInsight[])
    setOptimizerLoaded(true)
  }

  async function loadQuiz() {
    const { data } = await supabase.from("paywall_quizzes").select("*").eq("paywall_id", id).maybeSingle()
    if (data) {
      setQuiz({
        id: data.id,
        is_active: data.is_active ?? false,
        trigger_mode: data.trigger_mode ?? "before_paywall",
        questions: (data.questions as QuizQuestion[]) ?? [],
        completion_message: data.completion_message ?? "Great — finding your perfect plan…",
      })
    }
    setQuizLoaded(true)
  }

  async function saveQuiz() {
    setSavingQuiz(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()

      const payload = {
        paywall_id: id,
        account_id: profile?.account_id,
        is_active: quiz.is_active,
        trigger_mode: quiz.trigger_mode,
        questions: quiz.questions,
        completion_message: quiz.completion_message,
        ai_generated: false,
      }

      if (quiz.id) {
        await supabase.from("paywall_quizzes").update(payload).eq("id", quiz.id)
      } else {
        const { data } = await supabase.from("paywall_quizzes").upsert(
          payload, { onConflict: "paywall_id" }
        ).select().single()
        if (data) setQuiz(q => ({ ...q, id: data.id }))
      }
      toast.success("Quiz saved")
    } catch { toast.error("Failed to save quiz") }
    finally { setSavingQuiz(false) }
  }

  async function generateQuizQuestions() {
    setGeneratingQuiz(true)
    try {
      const res = await fetch("/api/ai/generate-quiz-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paywall_id: id }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Generation failed"); return }
      setQuiz(q => ({ ...q, questions: data.questions ?? [], ai_generated: true }))
      toast.success(`✨ ${data.questions?.length ?? 0} questions generated`)
    } catch { toast.error("Failed to generate questions") }
    finally { setGeneratingQuiz(false) }
  }

  function updateQuestion(idx: number, field: keyof QuizQuestion, value: string) {
    setQuiz(q => {
      const qs = [...q.questions]
      qs[idx] = { ...qs[idx], [field]: value }
      return { ...q, questions: qs }
    })
  }

  function updateQuestionOption(qIdx: number, oIdx: number, field: "value" | "label", value: string) {
    setQuiz(q => {
      const qs = [...q.questions]
      const opts = [...qs[qIdx].options]
      opts[oIdx] = { ...opts[oIdx], [field]: value }
      qs[qIdx] = { ...qs[qIdx], options: opts }
      return { ...q, questions: qs }
    })
  }

  function addQuestion() {
    const newQ: QuizQuestion = {
      id: `q${quiz.questions.length + 1}_custom`,
      question: "New question",
      type: "single_choice",
      options: [
        { value: "option_a", label: "Option A" },
        { value: "option_b", label: "Option B" },
      ],
    }
    setQuiz(q => ({ ...q, questions: [...q.questions, newQ] }))
    setEditingQuestionIdx(quiz.questions.length)
  }

  function removeQuestion(idx: number) {
    setQuiz(q => ({ ...q, questions: q.questions.filter((_, i) => i !== idx) }))
    setEditingQuestionIdx(null)
  }

  async function handleGenerateVariants() {
    setAgentLoading(true)
    try {
      const res = await fetch("/api/agent/generate-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paywall_id: id, count: 3, force: false }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.skip) { toast.info(data.message) } else { toast.error(data.error ?? "Generation failed") }
        return
      }
      toast.success(`✨ ${data.variants_created} variants created — ${data.strategy_summary}`)
      setOptimizerLoaded(false)
      await loadOptimizer()
    } catch { toast.error("Generation failed") }
    finally { setAgentLoading(false) }
  }

  async function handleReflect() {
    setAgentLoading(true)
    try {
      const res = await fetch("/api/agent/reflect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paywall_id: id }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Reflection failed"); return }
      toast.success(`🔍 Reflection done — ${data.actions_taken?.length ?? 0} actions taken`)
      setOptimizerLoaded(false)
      await loadOptimizer()
    } catch { toast.error("Reflection failed") }
    finally { setAgentLoading(false) }
  }

  async function archiveVariant(variantId: string) {
    await supabase.from("paywall_variants").update({ archived_at: new Date().toISOString(), archive_reason: "Manually archived by founder" }).eq("id", variantId)
    setVariants(v => v.filter(x => x.id !== variantId))
    toast.success("Variant archived")
  }

  function update<K extends keyof PaywallConfig>(key: K, value: PaywallConfig[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function updateTrigger(key: string, value: unknown) {
    setForm(f => ({
      ...f,
      trigger_config: { ...(f.trigger_config ?? DEFAULT_TRIGGER_CONFIG), [key]: value }
    }))
  }

  function updateLocalization(lang: string, field: string, value: string) {
    setForm(f => ({
      ...f,
      localizations: {
        ...(f.localizations ?? {}),
        [lang]: {
          ...((f.localizations ?? {})[lang] ?? {}),
          [field]: value,
        }
      }
    }))
  }

  function addBadge() {
    const badge = newBadge.trim()
    if (!badge) return
    update("trust_badges", [...(form.trust_badges ?? []), badge])
    setNewBadge("")
  }

  function removeBadge(i: number) {
    update("trust_badges", (form.trust_badges ?? []).filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase.from("paywalls").update({ ...form, updated_at: new Date().toISOString() }).eq("id", id)
    if (error) { toast.error(error.message); setSaving(false); return }

    // Keep control variant in sync with paywall edits
    await supabase.from("paywall_variants").update({
      headline: form.headline,
      subheadline: form.subheadline ?? null,
      cta_copy: form.cta_copy,
      accent_color: (form.design as Record<string, string>)?.accentColor ?? "#6366F1",
    }).eq("paywall_id", id).eq("is_control", true)

    toast.success("Saved")
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
      if (!res.ok) { toast.error(data.error ?? "Failed to generate copy"); return }
      setAiSuggestions(data.variations ?? [])
      toast.success("AI copy generated!")
    } catch { toast.error("Failed to generate copy") }
    finally { setGeneratingAi(false) }
  }

  function applyAiVariation(idx: number) {
    const v = aiSuggestions[idx]
    if (!v) return
    update("headline", v.headline)
    update("subheadline", v.subheadline)
    update("cta_copy", v.cta_text)
    if (v.body_copy) update("body_copy", v.body_copy)
    if (v.guarantee_text) update("guarantee_text", v.guarantee_text)
    if (v.urgency_text) update("urgency_text", v.urgency_text)
    if (v.trust_badges?.length) update("trust_badges", v.trust_badges)
    setAppliedIdx(idx)
    toast.success("Copy applied!")
  }

  function copyInstallSnippet() {
    const snippet = `<script async src="${getSdkScriptUrl()}" data-key="${apiKey}"></script>`
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
  const tc = form.trigger_config ?? DEFAULT_TRIGGER_CONFIG
  const locs = form.localizations ?? {}
  const accentColor = (form.design as Record<string, string>)?.accentColor ?? "#6366F1"

  return (
    <div className="flex h-screen bg-[#0A0A0B]">
      {/* Left Panel */}
      <div className="w-[310px] flex-shrink-0 border-r border-white/6 flex flex-col overflow-hidden">
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
          <Link
            href={`/paywalls/${paywall.id}/integrate`}
            className="flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors bg-indigo-500/10 hover:bg-indigo-500/15 px-2 py-1 rounded"
          >
            <Zap className="w-3 h-3" />
            Integrate
          </Link>
        </div>

        {/* Tabs — scrollable */}
        <div className="flex border-b border-white/6 overflow-x-auto scrollbar-none">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`flex-shrink-0 px-3 py-2.5 text-[11px] font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                activeTab === i ? "text-white border-indigo-500" : "text-[#52525B] border-transparent hover:text-[#A1A1AA]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* ── DESIGN TAB ─────────────────────────────────────────── */}
          {activeTab === 0 && (
            <>
              {/* Chameleon mode */}
              <div className={`p-3 rounded-xl border transition-all ${
                (form.theme_mode ?? "auto") === "auto"
                  ? "border-indigo-500/30 bg-indigo-500/8"
                  : "border-white/6 bg-white/2"
              }`}>
                <div className="flex items-start gap-2.5">
                  <span className="text-base leading-none mt-0.5">🦎</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-white">Chameleon mode</p>
                      <button
                        onClick={() => update("theme_mode", (form.theme_mode ?? "auto") === "auto" ? "manual" : "auto")}
                        className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${(form.theme_mode ?? "auto") === "auto" ? "bg-indigo-600" : "bg-white/10"}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${(form.theme_mode ?? "auto") === "auto" ? "translate-x-4.5" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                    <p className="text-[10px] text-[#71717A]">Automatically match your app&apos;s fonts, colors and style. The paywall blends into any host app.</p>
                    {(form.theme_mode ?? "auto") === "auto" && (
                      <div className="mt-2.5 space-y-1.5">
                        {([
                          ["adapt_font", "Adapt fonts"],
                          ["adapt_colors", "Adapt colors"],
                          ["adapt_radius", "Adapt radius"],
                        ] as [keyof PaywallConfig, string][]).map(([key, label]) => (
                          <div key={key} className="flex items-center justify-between">
                            <span className="text-[10px] text-[#71717A]">{label}</span>
                            <button
                              onClick={() => update(key, !(form[key] ?? true))}
                              className={`w-7 h-4 rounded-full transition-colors relative ${(form[key] ?? true) ? "bg-indigo-600" : "bg-white/10"}`}
                            >
                              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${(form[key] ?? true) ? "translate-x-3.5" : "translate-x-0.5"}`} />
                            </button>
                          </div>
                        ))}
                        <p className="text-[10px] text-indigo-400/70 mt-1.5 italic">Preview shows default styling. The live paywall adapts to your app automatically.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Design controls — dimmed in auto/chameleon mode */}
              <div className={`space-y-4 ${(form.theme_mode ?? "auto") === "auto" ? "opacity-50 pointer-events-none select-none" : ""}`}>

              {/* Templates */}
              <div>
                <label className="text-xs text-[#71717A] mb-2 block font-medium">Template</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "classic-modal", label: "Classic Modal", desc: "Centered overlay" },
                    { key: "slide-in", label: "Slide-in", desc: "Corner popup" },
                    { key: "fullscreen", label: "Full Screen", desc: "2-column layout" },
                    { key: "bottom-sheet", label: "Bottom Sheet", desc: "Slides from bottom" },
                    { key: "minimal", label: "Minimal", desc: "Ultra-clean" },
                    { key: "side-panel", label: "Side Panel", desc: "Right drawer" },
                  ].map(t => (
                    <button
                      key={t.key}
                      onClick={() => update("template", t.key)}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        form.template === t.key
                          ? "border-indigo-500/50 bg-indigo-500/10"
                          : "border-white/6 bg-white/3 hover:border-white/12"
                      }`}
                    >
                      <p className={`text-[11px] font-semibold ${form.template === t.key ? "text-indigo-400" : "text-[#A1A1AA]"}`}>{t.label}</p>
                      <p className="text-[10px] text-[#52525B] mt-0.5">{t.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Accent color */}
              <div>
                <label className="text-xs text-[#71717A] mb-2 block font-medium">Accent color</label>
                <div className="flex gap-2 flex-wrap">
                  {["#6366F1", "#8B5CF6", "#EC4899", "#10B981", "#F59E0B", "#3B82F6", "#EF4444", "#14B8A6"].map(c => (
                    <button
                      key={c}
                      onClick={() => update("design", { ...(form.design ?? {}), accentColor: c })}
                      className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                        accentColor === c ? "border-white scale-110" : "border-transparent"
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Font family */}
              <div>
                <label className="text-xs text-[#71717A] mb-2 block font-medium">Font family</label>
                <div className="flex gap-2">
                  {[
                    { key: "system", label: "System" },
                    { key: "serif", label: "Serif" },
                    { key: "mono", label: "Mono" },
                  ].map(f => (
                    <button
                      key={f.key}
                      onClick={() => update("font_family", f.key as "system" | "serif" | "mono")}
                      className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                        (form.font_family ?? "system") === f.key
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                          : "border-white/6 bg-white/3 text-[#71717A] hover:text-[#A1A1AA]"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Button shape */}
              <div>
                <label className="text-xs text-[#71717A] mb-2 block font-medium">Button shape</label>
                <div className="flex gap-2">
                  {[
                    { key: "rounded", label: "Rounded" },
                    { key: "pill", label: "Pill" },
                    { key: "square", label: "Square" },
                  ].map(s => (
                    <button
                      key={s.key}
                      onClick={() => update("button_shape", s.key as "rounded" | "pill" | "square")}
                      className={`flex-1 py-1.5 text-[11px] font-medium border transition-all ${
                        s.key === "pill" ? "rounded-full" : s.key === "square" ? "rounded" : "rounded-lg"
                      } ${
                        (form.button_shape ?? "rounded") === s.key
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                          : "border-white/6 bg-white/3 text-[#71717A] hover:text-[#A1A1AA]"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Overlay opacity */}
              <div>
                <label className="text-xs text-[#71717A] mb-2 flex justify-between font-medium">
                  <span>Overlay opacity</span>
                  <span className="text-white font-mono">{form.overlay_opacity ?? 65}%</span>
                </label>
                <input
                  type="range" min={0} max={95} step={5}
                  value={form.overlay_opacity ?? 65}
                  onChange={e => update("overlay_opacity", Number(e.target.value))}
                  className="w-full accent-indigo-500 h-1.5"
                />
              </div>

              {/* Animation style */}
              <div>
                <label className="text-xs text-[#71717A] mb-2 block font-medium">Animation</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {["slide", "fade", "zoom", "none"].map(a => (
                    <button
                      key={a}
                      onClick={() => update("animation_style", a as "slide" | "fade" | "zoom" | "none")}
                      className={`py-1.5 text-[10px] font-medium rounded-lg border capitalize transition-all ${
                        (form.animation_style ?? "slide") === a
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                          : "border-white/6 bg-white/3 text-[#71717A] hover:text-[#A1A1AA]"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-2.5 pt-1">
                {([
                  ["closeable", "Closeable"],
                  ["show_yearly_toggle", "Yearly toggle"],
                ] as [keyof PaywallConfig, string][]).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between">
                    <label className="text-xs text-[#A1A1AA]">{label}</label>
                    <button
                      onClick={() => update(key, !form[key])}
                      className={`w-9 h-5 rounded-full transition-colors relative ${form[key] ? "bg-indigo-600" : "bg-white/10"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form[key] ? "translate-x-4.5" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                ))}
              </div>
              </div>{/* /design controls dim wrapper */}
            </>
          )}

          {/* ── CONTENT TAB ────────────────────────────────────────── */}
          {activeTab === 1 && (
            <>
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Headline</label>
                <textarea value={form.headline ?? ""} onChange={e => update("headline", e.target.value)} rows={2} className="hatch-input resize-none text-sm" />
              </div>
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Subheadline</label>
                <input value={form.subheadline ?? ""} onChange={e => update("subheadline", e.target.value)} className="hatch-input text-sm" placeholder="Optional tagline" />
              </div>
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Body copy</label>
                <textarea value={form.body_copy ?? ""} onChange={e => update("body_copy", e.target.value)} rows={3} className="hatch-input resize-none text-sm" placeholder="✓ Feature one&#10;✓ Feature two&#10;✓ Feature three" />
              </div>
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">CTA copy</label>
                <input value={form.cta_copy ?? ""} onChange={e => update("cta_copy", e.target.value)} className="hatch-input text-sm" />
              </div>

              {/* Social proof */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Social proof type</label>
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {(["none", "text", "stars", "user_count"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => update("social_proof_type", t)}
                      className={`py-1.5 text-[10px] font-medium rounded-lg border capitalize transition-all ${
                        (form.social_proof_type ?? "text") === t
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                          : "border-white/6 bg-white/3 text-[#71717A] hover:text-[#A1A1AA]"
                      }`}
                    >
                      {t === "user_count" ? "Count" : t}
                    </button>
                  ))}
                </div>
                {(form.social_proof_type ?? "text") !== "none" && (
                  <input value={form.social_proof ?? ""} onChange={e => update("social_proof", e.target.value)} className="hatch-input text-sm" placeholder="Trusted by 1,200+ founders" />
                )}
              </div>

              {/* Trust badges */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Trust badges</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(form.trust_badges ?? []).map((badge, i) => (
                    <span key={i} className="flex items-center gap-1 text-[10px] bg-white/5 border border-white/10 rounded-full px-2 py-0.5 text-[#A1A1AA]">
                      {badge}
                      <button onClick={() => removeBadge(i)} className="hover:text-red-400 transition-colors"><Trash2 className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={newBadge}
                    onChange={e => setNewBadge(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addBadge()}
                    placeholder="256-bit SSL, GDPR compliant…"
                    className="hatch-input text-xs flex-1"
                  />
                  <button onClick={addBadge} className="p-2 bg-white/5 border border-white/10 rounded-lg text-[#71717A] hover:text-white transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Guarantee */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Guarantee text</label>
                <input value={form.guarantee_text ?? ""} onChange={e => update("guarantee_text", e.target.value)} className="hatch-input text-sm" placeholder="30-day money-back guarantee" />
              </div>

              {/* Urgency */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Urgency text</label>
                <input value={form.urgency_text ?? ""} onChange={e => update("urgency_text", e.target.value)} className="hatch-input text-sm" placeholder="⚡ Limited time offer — 50% off" />
              </div>

              {/* Countdown */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[#A1A1AA]">Countdown timer</label>
                  <button
                    onClick={() => update("show_countdown", !form.show_countdown)}
                    className={`w-9 h-5 rounded-full transition-colors relative ${form.show_countdown ? "bg-indigo-600" : "bg-white/10"}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.show_countdown ? "translate-x-4.5" : "translate-x-0.5"}`} />
                  </button>
                </div>
                {form.show_countdown && (
                  <div>
                    <label className="text-[10px] text-[#71717A] mb-1 block">End date & time</label>
                    <input
                      type="datetime-local"
                      value={form.urgency_end_date ? form.urgency_end_date.slice(0, 16) : ""}
                      onChange={e => update("urgency_end_date", e.target.value ? new Date(e.target.value).toISOString() : null)}
                      className="hatch-input text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Footer */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Footer text</label>
                <input value={form.footer_text ?? ""} onChange={e => update("footer_text", e.target.value)} className="hatch-input text-sm" placeholder="Cancel anytime · No hidden fees" />
              </div>

              {/* AI Copy section */}
              <div className="pt-3 border-t border-white/6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-xs font-semibold text-white">AI Copy</span>
                  </div>
                  {aiSuggestions.length > 0 && (
                    <button onClick={generateAiCopy} disabled={generatingAi} className="flex items-center gap-1 text-[10px] text-[#52525B] hover:text-indigo-400 transition-colors">
                      <RefreshCw className={`w-3 h-3 ${generatingAi ? "animate-spin" : ""}`} />
                      Regenerate
                    </button>
                  )}
                </div>
                {!briefCompleted ? (
                  <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3 text-center">
                    <BookOpen className="w-4 h-4 text-amber-400 mx-auto mb-1.5" />
                    <p className="text-[11px] text-amber-400 font-medium mb-1">Brief required</p>
                    <p className="text-[10px] text-[#71717A] mb-2">Complete your Project Brief to unlock AI copy</p>
                    <Link href="/settings/project-brief" className="text-[10px] text-indigo-400 hover:text-indigo-300">Complete brief →</Link>
                  </div>
                ) : aiSuggestions.length === 0 ? (
                  <button onClick={generateAiCopy} disabled={generatingAi} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 text-xs font-medium transition-all disabled:opacity-50">
                    {generatingAi ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</> : <><Sparkles className="w-3.5 h-3.5" /> Generate 3 variations</>}
                  </button>
                ) : (
                  <div className="space-y-2">
                    {aiSuggestions.map((v, i) => (
                      <div key={i} className={`rounded-lg border p-3 transition-all ${appliedIdx === i ? "bg-emerald-500/5 border-emerald-500/20" : "bg-white/2 border-white/8"}`}>
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="text-[10px] text-indigo-400 font-semibold capitalize">{v.emotional_driver.replace(/_/g, " ")}</p>
                          <span className="text-[9px] text-[#52525B] capitalize italic">{v.tone}</span>
                        </div>
                        <p className="text-xs font-semibold text-white mb-1 leading-snug">{v.headline}</p>
                        {v.subheadline && <p className="text-[10px] text-[#71717A] mb-2 leading-relaxed">{v.subheadline}</p>}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[#52525B] font-mono">CTA: {v.cta_text}</span>
                          <button
                            onClick={() => applyAiVariation(i)}
                            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded transition-all ${
                              appliedIdx === i ? "text-emerald-400" : "text-indigo-400 hover:text-white hover:bg-indigo-500/20"
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

          {/* ── PRICING TAB ────────────────────────────────────────── */}
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

              <div className="pt-3 border-t border-white/6 space-y-4">
                {/* Currency */}
                <div>
                  <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Currency</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {CURRENCIES.map(c => (
                      <button
                        key={c}
                        onClick={() => update("currency", c)}
                        className={`py-1.5 text-[11px] font-mono font-medium rounded-lg border transition-all ${
                          (form.currency ?? "USD") === c
                            ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                            : "border-white/6 bg-white/3 text-[#71717A] hover:text-[#A1A1AA]"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Yearly discount */}
                <div>
                  <label className="text-xs text-[#71717A] mb-2 flex justify-between font-medium">
                    <span>Yearly discount</span>
                    <span className="text-white font-mono">{form.yearly_discount_percent ?? 20}%</span>
                  </label>
                  <input
                    type="range" min={5} max={50} step={5}
                    value={form.yearly_discount_percent ?? 20}
                    onChange={e => update("yearly_discount_percent", Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5"
                  />
                </div>

                {/* Show trial in CTA */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs text-[#A1A1AA]">Show trial in CTA</label>
                    <p className="text-[10px] text-[#52525B]">e.g. "Start 7-day free trial"</p>
                  </div>
                  <button
                    onClick={() => update("show_trial_in_cta", !form.show_trial_in_cta)}
                    className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${form.show_trial_in_cta ? "bg-indigo-600" : "bg-white/10"}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.show_trial_in_cta ? "translate-x-4.5" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── QUIZ TAB ───────────────────────────────────────────── */}
          {activeTab === 3 && (
            <div className="space-y-4">
              {/* Enable toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/3 border border-white/6">
                <div>
                  <p className="text-xs font-medium text-[#A1A1AA]">Enable pre-paywall quiz</p>
                  <p className="text-[10px] text-[#52525B] mt-0.5">Show a quiz before the paywall to personalise the offer</p>
                </div>
                <button
                  onClick={() => setQuiz(q => ({ ...q, is_active: !q.is_active }))}
                  className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${quiz.is_active ? "bg-indigo-600" : "bg-white/10"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${quiz.is_active ? "translate-x-4.5" : "translate-x-0.5"}`} />
                </button>
              </div>

              {quiz.is_active && (
                <>
                  {/* Trigger mode */}
                  <div>
                    <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Quiz mode</label>
                    <div className="flex gap-2">
                      {([
                        { key: "before_paywall", label: "Required" },
                        { key: "optional", label: "Optional" },
                      ] as const).map(m => (
                        <button
                          key={m.key}
                          onClick={() => setQuiz(q => ({ ...q, trigger_mode: m.key }))}
                          className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                            quiz.trigger_mode === m.key
                              ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                              : "border-white/6 bg-white/3 text-[#71717A] hover:text-[#A1A1AA]"
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#52525B] mt-1.5">
                      {quiz.trigger_mode === "before_paywall"
                        ? "Users must complete the quiz before seeing the paywall."
                        : "A 'Skip' option is shown on the quiz."}
                    </p>
                  </div>

                  {/* Generate with AI */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={generateQuizQuestions}
                      disabled={generatingQuiz}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/30 text-xs font-medium transition-all disabled:opacity-50"
                    >
                      {generatingQuiz ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {generatingQuiz ? "Generating…" : "Generate with AI"}
                    </button>
                    <button
                      onClick={addQuestion}
                      className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-white/5 border border-white/10 text-[#A1A1AA] hover:text-white text-xs font-medium transition-all"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>

                  {/* Questions list */}
                  {quiz.questions.length === 0 && !generatingQuiz && (
                    <div className="text-center py-8 text-[#52525B] text-xs">
                      No questions yet — generate with AI or add manually.
                    </div>
                  )}

                  <div className="space-y-2">
                    {quiz.questions.map((q, qi) => (
                      <div key={qi} className="border border-white/6 rounded-lg overflow-hidden">
                        {/* Question header */}
                        <div
                          className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-white/3 transition-colors"
                          onClick={() => setEditingQuestionIdx(editingQuestionIdx === qi ? null : qi)}
                        >
                          <span className="text-[10px] text-indigo-400 font-mono font-semibold w-5 flex-shrink-0">Q{qi + 1}</span>
                          <span className="text-xs text-[#A1A1AA] flex-1 truncate">{q.question}</span>
                          <button
                            onClick={e => { e.stopPropagation(); removeQuestion(qi) }}
                            className="text-[#52525B] hover:text-red-400 transition-colors p-0.5"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Expanded editor */}
                        {editingQuestionIdx === qi && (
                          <div className="px-3 pb-3 space-y-2.5 border-t border-white/6 pt-2.5 bg-white/2">
                            <div>
                              <label className="text-[10px] text-[#52525B] mb-1 block">Question text</label>
                              <input
                                value={q.question}
                                onChange={e => updateQuestion(qi, "question", e.target.value)}
                                className="hatch-input text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-[#52525B] mb-1 block">Options</label>
                              <div className="space-y-1.5">
                                {q.options.map((opt, oi) => (
                                  <div key={oi} className="flex gap-1.5">
                                    <input
                                      value={opt.label}
                                      onChange={e => updateQuestionOption(qi, oi, "label", e.target.value)}
                                      className="hatch-input text-xs flex-1"
                                      placeholder="Option label"
                                    />
                                    <input
                                      value={opt.value}
                                      onChange={e => updateQuestionOption(qi, oi, "value", e.target.value)}
                                      className="hatch-input text-xs w-24 font-mono"
                                      placeholder="slug"
                                    />
                                    {q.options.length > 2 && (
                                      <button
                                        onClick={() => {
                                          setQuiz(prev => {
                                            const qs = [...prev.questions]
                                            qs[qi] = { ...qs[qi], options: qs[qi].options.filter((_, idx) => idx !== oi) }
                                            return { ...prev, questions: qs }
                                          })
                                        }}
                                        className="text-[#52525B] hover:text-red-400 transition-colors px-1"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                ))}
                                {q.options.length < 4 && (
                                  <button
                                    onClick={() => {
                                      setQuiz(prev => {
                                        const qs = [...prev.questions]
                                        const newOpt = { value: `opt_${qs[qi].options.length}`, label: "New option" }
                                        qs[qi] = { ...qs[qi], options: [...qs[qi].options, newOpt] }
                                        return { ...prev, questions: qs }
                                      })
                                    }}
                                    className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
                                  >
                                    <Plus className="w-2.5 h-2.5" /> Add option
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Completion message */}
                  <div>
                    <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Completion message</label>
                    <input
                      value={quiz.completion_message}
                      onChange={e => setQuiz(q => ({ ...q, completion_message: e.target.value }))}
                      className="hatch-input text-sm"
                      placeholder="Great — finding your perfect plan…"
                    />
                    <p className="text-[10px] text-[#52525B] mt-1">Shown for ~1s while the paywall loads after quiz completion.</p>
                  </div>
                </>
              )}

              {/* Save button */}
              <button
                onClick={saveQuiz}
                disabled={savingQuiz}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/5 border border-white/10 text-[#A1A1AA] hover:text-white text-xs font-medium transition-all disabled:opacity-50"
              >
                {savingQuiz ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {savingQuiz ? "Saving…" : "Save quiz"}
              </button>
            </div>
          )}

          {/* ── TRIGGERS TAB ───────────────────────────────────────── */}
          {activeTab === 4 && (
            <div className="space-y-4">
              <p className="text-xs text-[#71717A]">Configure when this paywall appears automatically.</p>

              {/* Manual trigger info */}
              <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3">
                <p className="text-xs font-medium text-indigo-400 mb-1">Manual trigger (always active)</p>
                <code className="text-[11px] text-indigo-300 font-mono">hatch.show(&apos;{id}&apos;)</code>
              </div>

              {/* Exit intent */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tc.exit_intent ?? false}
                  onChange={e => updateTrigger("exit_intent", e.target.checked)}
                  className="accent-indigo-500 mt-0.5"
                />
                <div>
                  <p className="text-xs font-medium text-[#A1A1AA]">Exit intent</p>
                  <p className="text-[10px] text-[#52525B]">Show when cursor leaves the viewport upward</p>
                </div>
              </label>

              {/* Time delay */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={tc.time_delay != null && tc.time_delay > 0}
                    onChange={e => updateTrigger("time_delay", e.target.checked ? 10 : null)}
                    className="accent-indigo-500"
                  />
                  Time delay
                </label>
                {tc.time_delay != null && tc.time_delay > 0 && (
                  <div className="flex items-center gap-2 ml-5">
                    <input
                      type="number" min={1} max={300}
                      value={tc.time_delay ?? 10}
                      onChange={e => updateTrigger("time_delay", Number(e.target.value))}
                      className="hatch-input text-sm w-20"
                    />
                    <span className="text-xs text-[#71717A]">seconds after page load</span>
                  </div>
                )}
              </div>

              {/* Scroll depth */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={tc.scroll_depth != null && tc.scroll_depth > 0}
                    onChange={e => updateTrigger("scroll_depth", e.target.checked ? 60 : null)}
                    className="accent-indigo-500"
                  />
                  Scroll depth
                </label>
                {tc.scroll_depth != null && tc.scroll_depth > 0 && (
                  <div className="flex items-center gap-2 ml-5">
                    <input
                      type="number" min={10} max={100} step={10}
                      value={tc.scroll_depth ?? 60}
                      onChange={e => updateTrigger("scroll_depth", Number(e.target.value))}
                      className="hatch-input text-sm w-20"
                    />
                    <span className="text-xs text-[#71717A]">% of page scrolled</span>
                  </div>
                )}
              </div>

              {/* Page count */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={tc.page_count != null && tc.page_count > 0}
                    onChange={e => updateTrigger("page_count", e.target.checked ? 3 : null)}
                    className="accent-indigo-500"
                  />
                  Page view count
                </label>
                {tc.page_count != null && tc.page_count > 0 && (
                  <div className="flex items-center gap-2 ml-5">
                    <span className="text-xs text-[#71717A]">Show on visit #</span>
                    <input
                      type="number" min={1} max={50}
                      value={tc.page_count ?? 3}
                      onChange={e => updateTrigger("page_count", Number(e.target.value))}
                      className="hatch-input text-sm w-20"
                    />
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-white/6 space-y-3">
                {/* Frequency */}
                <div>
                  <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Show frequency</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["always", "once", "daily", "weekly", "monthly"] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => updateTrigger("frequency", f)}
                        className={`py-1.5 text-[10px] font-medium rounded-lg border capitalize transition-all ${
                          (tc.frequency ?? "once") === f
                            ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                            : "border-white/6 bg-white/3 text-[#71717A] hover:text-[#A1A1AA]"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cooldown */}
                {(tc.frequency ?? "once") !== "always" && (tc.frequency ?? "once") !== "once" && (
                  <div>
                    <label className="text-xs text-[#71717A] mb-1.5 flex justify-between font-medium">
                      <span>Min. cooldown (hours)</span>
                    </label>
                    <input
                      type="number" min={1} max={720}
                      value={tc.cooldown_hours ?? 24}
                      onChange={e => updateTrigger("cooldown_hours", Number(e.target.value))}
                      className="hatch-input text-sm"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── LANGUAGES TAB ──────────────────────────────────────── */}
          {activeTab === 5 && (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 mb-1">
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-xs font-semibold text-white">Multi-language</span>
              </div>

              {/* Default locale */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Default locale</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {LOCALES.map(l => (
                    <button
                      key={l.code}
                      onClick={() => update("locale", l.code)}
                      className={`py-1.5 px-2 text-[11px] font-medium rounded-lg border text-left transition-all ${
                        (form.locale ?? "en") === l.code
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                          : "border-white/6 bg-white/3 text-[#71717A] hover:text-[#A1A1AA]"
                      }`}
                    >
                      {l.label} <span className="font-mono opacity-60">({l.code})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto-detect */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs text-[#A1A1AA]">Auto-detect browser language</label>
                  <p className="text-[10px] text-[#52525B]">Falls back to default if no match</p>
                </div>
                <button
                  onClick={() => update("auto_detect_locale", !form.auto_detect_locale)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${(form.auto_detect_locale ?? true) ? "bg-indigo-600" : "bg-white/10"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${(form.auto_detect_locale ?? true) ? "translate-x-4.5" : "translate-x-0.5"}`} />
                </button>
              </div>

              {/* Translations */}
              <div className="pt-2 border-t border-white/6">
                <p className="text-xs text-[#71717A] mb-2 font-medium">Translations</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {LOCALES.filter(l => l.code !== (form.locale ?? "en")).map(l => (
                    <button
                      key={l.code}
                      onClick={() => setActiveLang(activeLang === l.code ? null : l.code)}
                      className={`px-2 py-1 text-[10px] font-medium rounded-lg border transition-all ${
                        activeLang === l.code
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                          : locs[l.code]
                          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                          : "border-white/6 bg-white/3 text-[#52525B] hover:text-[#A1A1AA]"
                      }`}
                    >
                      {l.label}
                      {locs[l.code] && <span className="ml-1 text-emerald-400">✓</span>}
                    </button>
                  ))}
                </div>

                {activeLang && (
                  <div className="bg-white/2 border border-white/8 rounded-lg p-3 space-y-2.5">
                    <p className="text-[11px] font-semibold text-white mb-2">
                      {LOCALES.find(l => l.code === activeLang)?.label} overrides
                    </p>
                    {[
                      ["headline", "Headline"],
                      ["subheadline", "Subheadline"],
                      ["cta_copy", "CTA copy"],
                      ["footer_text", "Footer text"],
                      ["guarantee_text", "Guarantee"],
                    ].map(([field, label]) => (
                      <div key={field}>
                        <label className="text-[10px] text-[#71717A] mb-1 block">{label}</label>
                        <input
                          value={locs[activeLang]?.[field] ?? ""}
                          onChange={e => updateLocalization(activeLang, field, e.target.value)}
                          placeholder={`Default: ${form[field as keyof PaywallConfig] ?? "—"}`}
                          className="hatch-input text-xs"
                        />
                      </div>
                    ))}
                  </div>
                )}
                {!activeLang && (
                  <p className="text-[10px] text-[#52525B] text-center py-2">Select a language above to add translations</p>
                )}
              </div>
            </div>
          )}

          {/* ── ADVANCED TAB ───────────────────────────────────────── */}
          {activeTab === 6 && (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 mb-1">
                <Code2 className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-xs font-semibold text-white">Advanced settings</span>
              </div>

              {/* Custom CSS */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Custom CSS</label>
                <p className="text-[10px] text-[#52525B] mb-1.5">Injected inside the paywall iframe. Use <code className="font-mono text-indigo-300">.hatch-*</code> selectors.</p>
                <textarea
                  value={form.custom_css ?? ""}
                  onChange={e => update("custom_css", e.target.value)}
                  rows={6}
                  className="hatch-input resize-none text-xs font-mono"
                  placeholder={`.hatch-modal {\n  border: 2px solid gold;\n}\n.hatch-cta-btn {\n  background: linear-gradient(...);\n}`}
                />
              </div>

              {/* Success redirect */}
              <div>
                <label className="text-xs text-[#71717A] mb-1.5 block font-medium">Post-purchase redirect URL</label>
                <input
                  value={form.success_redirect_url ?? ""}
                  onChange={e => update("success_redirect_url", e.target.value)}
                  placeholder="https://myapp.com/welcome"
                  className="hatch-input text-sm"
                />
                <p className="text-[10px] text-[#52525B] mt-1">Redirect user to this URL after successful payment</p>
              </div>

              {/* Hide powered by */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs text-[#A1A1AA]">Hide "Powered by Hatch" badge</label>
                  <p className="text-[10px] text-[#52525B]">Requires Pro plan or higher</p>
                </div>
                <button
                  onClick={() => update("hide_powered_by", !form.hide_powered_by)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${form.hide_powered_by ? "bg-indigo-600" : "bg-white/10"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.hide_powered_by ? "translate-x-4.5" : "translate-x-0.5"}`} />
                </button>
              </div>
            </div>
          )}

          {/* ── AI OPTIMIZER TAB ───────────────────────────────────── */}
          {activeTab === 7 && (
            <div className="space-y-5">
              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleGenerateVariants}
                  disabled={agentLoading}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/30 text-xs font-medium transition-all disabled:opacity-50"
                >
                  {agentLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Generate
                </button>
                <button
                  onClick={handleReflect}
                  disabled={agentLoading}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/5 border border-white/10 text-[#A1A1AA] hover:text-white text-xs font-medium transition-all disabled:opacity-50"
                >
                  {agentLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                  Reflect
                </button>
              </div>

              {/* Active Variants */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-xs font-semibold text-white">Active Variants</span>
                  <span className="ml-auto text-[10px] text-[#52525B]">{variants.length} running</span>
                </div>
                {variants.length === 0 ? (
                  <div className="bg-white/2 border border-dashed border-white/10 rounded-lg p-4 text-center">
                    <p className="text-[11px] text-[#52525B]">No variants yet. Click "Generate" to start.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {variants.map(v => {
                      const total = (v.posterior_alpha ?? 1) + (v.posterior_beta ?? 1) - 2
                      const convRate = total > 0 ? ((v.posterior_alpha ?? 1) - 1) / total * 100 : 0
                      return (
                        <div key={v.id} className="bg-white/3 border border-white/6 rounded-lg p-3 space-y-2">
                          <div className="flex items-start justify-between gap-1">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-semibold text-white truncate">{v.name}</span>
                                {v.is_control && <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-[#71717A] font-medium">CONTROL</span>}
                                {v.generated_by === "ai" && <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-medium">AI</span>}
                              </div>
                              {v.hypothesis && <p className="text-[10px] text-[#52525B] italic mt-0.5 leading-tight">{v.hypothesis}</p>}
                            </div>
                            {!v.is_control && (
                              <button onClick={() => archiveVariant(v.id)} className="p-1 text-[#52525B] hover:text-red-400 transition-colors flex-shrink-0" title="Archive">
                                <Archive className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-[#71717A]">{v.views ?? 0} views</span>
                            <span className="text-[#71717A]">{v.conversions ?? 0} conv</span>
                            <span className={convRate > 0 ? "text-emerald-400 font-mono" : "text-[#52525B] font-mono"}>
                              {total > 0 ? `${convRate.toFixed(1)}%` : "—"}
                            </span>
                          </div>
                          <div className="w-full bg-white/5 rounded-full h-1">
                            <div className="h-1 rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.min(100, (v.views ?? 0) / 200 * 100)}%` }} />
                          </div>
                          <p className="text-[9px] text-[#52525B]">{(v.views ?? 0) < 100 ? `${100 - (v.views ?? 0)} views to confidence` : "Sufficient data"}</p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Agent Activity */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Activity className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-xs font-semibold text-white">Agent Activity</span>
                </div>
                {agentRuns.length === 0 ? (
                  <p className="text-[11px] text-[#52525B] text-center py-2">No runs yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {agentRuns.slice(0, 8).map(r => (
                      <div key={r.id} className="flex items-start gap-2 bg-white/2 rounded-lg p-2.5 border border-white/5">
                        <span className="text-base mt-0.5 flex-shrink-0">{r.run_type === "generation" ? "✨" : "🔍"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[10px] text-white font-medium capitalize">{r.run_type}</span>
                            <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                              r.status === "succeeded" ? "text-emerald-400 bg-emerald-500/10" :
                              r.status === "failed" ? "text-red-400 bg-red-500/10" : "text-amber-400 bg-amber-500/10"
                            }`}>{r.status}</span>
                            <span className="text-[9px] text-[#52525B] ml-auto flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />{new Date(r.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          {r.reasoning && <p className="text-[10px] text-[#71717A] leading-tight">{r.reasoning}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Insights Memory */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-semibold text-white">Insights Memory</span>
                  <span className="ml-auto text-[10px] text-[#52525B]">{insights.length} total</span>
                </div>
                {insights.length === 0 ? (
                  <p className="text-[11px] text-[#52525B] text-center py-2">Run "Reflect" to extract insights</p>
                ) : (
                  <div className="space-y-2">
                    {insights.slice(0, 5).map(ins => (
                      <div key={ins.id} className="bg-white/2 border border-white/6 rounded-lg p-3">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium capitalize ${
                            ins.category === "copy" ? "bg-indigo-500/20 text-indigo-400" :
                            ins.category === "pricing" ? "bg-emerald-500/15 text-emerald-400" :
                            ins.category === "cta" ? "bg-purple-500/15 text-purple-400" :
                            "bg-white/8 text-[#71717A]"
                          }`}>{ins.category}</span>
                          <div className="flex gap-0.5 ml-auto">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < Math.round(ins.importance / 2) ? "bg-amber-400" : "bg-white/10"}`} />
                            ))}
                          </div>
                        </div>
                        <p className="text-[11px] text-white leading-snug">{ins.insight}</p>
                        {(ins.evidence as Record<string, string>)?.summary && (
                          <p className="text-[9px] text-[#52525B] mt-1">{(ins.evidence as Record<string, string>).summary}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-white/6 space-y-2">
          {form.status !== "live" && !canPublish && (
            <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg px-2.5 py-2 mb-1 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] ${stripeConnected ? "text-emerald-400" : "text-amber-400"}`}>
                  {stripeConnected ? "✓" : "✗"} Stripe {stripeConnected ? "connected" : "not connected"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] ${hasSelectedPlans ? "text-emerald-400" : "text-amber-400"}`}>
                  {hasSelectedPlans ? "✓" : "✗"} {hasSelectedPlans ? "Plan selected" : "No plan selected on this paywall"}
                </span>
              </div>
              <button
                onClick={refreshPublishStatus}
                className="flex items-center gap-1 text-[10px] text-[#52525B] hover:text-[#A1A1AA] transition-colors mt-0.5"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                Refresh status
              </button>
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
                accentColor={accentColor}
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
            {[
              { label: "Views", value: paywall.views.toLocaleString(), color: "text-white" },
              { label: "Conversions", value: paywall.conversions.toLocaleString(), color: "text-white" },
              { label: "Conv. rate", value: paywall.views > 0 ? `${((paywall.conversions / paywall.views) * 100).toFixed(1)}%` : "—", color: "text-emerald-400" },
              { label: "Revenue", value: `$${(paywall.revenue_cents / 100).toFixed(0)}`, color: "text-white" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white/3 border border-white/6 rounded-lg p-3">
                <p className="text-[10px] text-[#71717A] mb-1">{label}</p>
                <p className={`font-mono text-lg ${color}`}>{value}</p>
              </div>
            ))}
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
              {`<script async\n  src="${getSdkScriptUrl()}"\n  data-key="${apiKey || "pk_…"}"\n></script>`}
            </code>
            <button onClick={copyInstallSnippet} className="absolute top-2 right-2 p-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 transition-colors" title="Copy snippet">
              {snippetCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-[#71717A]" />}
            </button>
          </div>
          <p className="text-[9px] text-[#52525B] mb-3">Paste once in your app&apos;s <code className="font-mono">&lt;head&gt;</code></p>

          <h3 className="text-xs font-semibold text-[#71717A] mb-2 uppercase tracking-wide">Trigger</h3>
          <div className="bg-[#0A0A0B] border border-white/6 rounded-lg p-2.5">
            <code className="text-[10px] text-indigo-300 font-mono break-all">
              hatch.show(&apos;{id}&apos;)
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
        .scrollbar-none::-webkit-scrollbar{display:none;}
        .scrollbar-none{-ms-overflow-style:none;scrollbar-width:none;}
      `}</style>
    </div>
  )
}

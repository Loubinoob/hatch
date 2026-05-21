"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Check, Copy, Loader2, Plus, Trash2, ExternalLink, Zap, Sparkles } from "lucide-react"
import { generateApiKey } from "@/lib/utils"

const PLATFORMS = [
  { value: "lovable", label: "Lovable" },
  { value: "bolt", label: "Bolt" },
  { value: "replit", label: "Replit" },
  { value: "cursor", label: "Cursor" },
  { value: "v0", label: "v0" },
  { value: "other", label: "Other" },
]

const STEPS = ["Profile", "Connect Stripe", "Create Plans", "Get Snippet"]

const VALID_CATEGORIES = ["saas","productivity","developer-tools","ai-tools","design","marketing","finance","education","other"]
const VALID_TONES = ["professional","friendly","bold","minimal","playful","urgent"]

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sdkDetected, setSdkDetected] = useState(false)

  // Step 0 — profile
  const [profile, setProfile] = useState({
    fullName: "",
    appName: "",
    appUrl: "",
    platform: "",
  })

  // Step 1 — stripe
  const [stripeConnected, setStripeConnected] = useState(false)
  const [stripeEmail, setStripeEmail] = useState("")

  // Step 2 — plans
  const [plans, setPlans] = useState([
    { name: "Pro", price: 19, interval: "monthly" as const, features: ["Unlimited usage", "Priority support", "Advanced analytics"] },
  ])

  // Step 3 — snippet
  const [apiKey] = useState(() => generateApiKey())
  const [snippetTab, setSnippetTab] = useState<"html" | "react" | "lovable">("html")

  // ─── Detect return from Stripe OAuth ─────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connectOrigin = sessionStorage.getItem("stripe_connect_origin")
    if (params.get("stripe_connected") === "true" && connectOrigin === "onboarding") {
      sessionStorage.removeItem("stripe_connect_origin")
      setStripeConnected(true)
      setStripeEmail(params.get("stripe_email") ?? "")
      setStep(1)
      window.history.replaceState({}, "", "/onboarding")
    }
  }, [])

  // ─── Plan helpers ────────────────────────────────────────────────────────────
  function addPlan() {
    setPlans([...plans, { name: "Business", price: 49, interval: "monthly", features: ["Everything in Pro", "Team members", "API access"] }])
  }
  function removePlan(i: number) { setPlans(plans.filter((_, idx) => idx !== i)) }
  function updatePlan(i: number, field: string, value: string | number) {
    setPlans(plans.map((p, idx) => idx === i ? { ...p, [field]: value } : p))
  }
  function addFeature(planIdx: number) {
    setPlans(plans.map((p, idx) => idx === planIdx ? { ...p, features: [...p.features, ""] } : p))
  }
  function updateFeature(planIdx: number, featIdx: number, value: string) {
    setPlans(plans.map((p, idx) =>
      idx === planIdx ? { ...p, features: p.features.map((f, fi) => fi === featIdx ? value : f) } : p
    ))
  }

  // ─── Step 0: Profile + AI analysis ──────────────────────────────────────────
  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push("/login"); return }

    const accountId = crypto.randomUUID()
    const slug = profile.appName.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6)

    const { error: accountErr } = await supabase
      .from("accounts")
      .insert({ id: accountId, name: profile.appName, slug, app_name: profile.appName, app_url: profile.appUrl || null, platform: profile.platform || null })
    if (accountErr) { toast.error(accountErr.message); setLoading(false); return }

    const { error: userErr } = await supabase.from("users").upsert({
      id: user.id,
      account_id: accountId,
      full_name: profile.fullName,
      email: user.email!,
      api_key: apiKey,
    })
    if (userErr) { toast.error(userErr.message); setLoading(false); return }

    setLoading(false)

    // ── AI analysis of the app URL ──
    if (profile.appUrl) {
      setAnalyzing(true)
      try {
        const res = await fetch("/api/ai/analyze-app", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: profile.appUrl }),
        })
        if (res.ok) {
          const data = await res.json()
          const b = data.brief
          if (b) {
            await supabase.from("project_briefs").insert({
              account_id: accountId,
              app_description: b.app_description || null,
              app_category: VALID_CATEGORIES.includes(b.app_category) ? b.app_category : "other",
              icp_description: b.icp_description || null,
              core_problem: b.core_problem || null,
              emotional_drivers: Array.isArray(b.emotional_drivers) ? b.emotional_drivers : [],
              key_benefits: Array.isArray(b.key_benefits) ? b.key_benefits : [],
              competitors: Array.isArray(b.competitors) ? b.competitors : [],
              price_anchor: b.price_anchor || null,
              tone_of_voice: VALID_TONES.includes(b.tone_of_voice) ? b.tone_of_voice : null,
              auto_generated_at: new Date().toISOString(),
              auto_generated_source: "url",
              completed_at: new Date().toISOString(),
            })
          }
        }
      } catch {
        // Silently fail — brief can be updated later in Settings
      }
      setAnalyzing(false)
    }

    setStep(1)
  }

  // ─── Step 1: Stripe ──────────────────────────────────────────────────────────
  function handleStripeConnect() {
    // Mark origin so the callback can redirect back here
    sessionStorage.setItem("stripe_connect_origin", "onboarding")
    window.location.href = "/api/stripe/connect"
  }

  // ─── Step 2: Plans ───────────────────────────────────────────────────────────
  async function handlePlansSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: userProfile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
    if (!userProfile) { toast.error("Profile not found. Please refresh."); setLoading(false); return }

    for (const plan of plans) {
      const { error } = await supabase.from("plans").insert({
        account_id: userProfile.account_id,
        name: plan.name,
        price_monthly: plan.price * 100,
        price_yearly: Math.round(plan.price * 10 * 100),
        features: plan.features.filter(Boolean),
      })
      if (error) { toast.error(error.message); setLoading(false); return }
    }

    setLoading(false)
    setStep(3)
  }

  // ─── Step 3: Finish ──────────────────────────────────────────────────────────
  async function handleFinish() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from("users").update({ onboarding_completed: true }).eq("id", user.id)
    router.push("/dashboard")
  }

  function copySnippet() {
    const snippet = `<script async src="https://cdn.hatch.io/v1/sdk.js" data-key="${apiKey}"></script>`
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function testIntegration() {
    setSdkDetected(true)
    toast.success("SDK detected! You're all set.")
  }

  const snippetHtml = `<script async src="https://cdn.hatch.io/v1/sdk.js" data-key="${apiKey}"></script>`
  const snippetReact = `import { HatchProvider } from '@hatch/react'

// Wrap your app:
<HatchProvider apiKey="${apiKey}">
  <App />
</HatchProvider>`
  const snippetLovable = `// In Lovable, go to Settings → Custom Scripts and paste:
<script async src="https://cdn.hatch.io/v1/sdk.js" data-key="${apiKey}"></script>`

  return (
    <div className="min-h-screen bg-[#0A0A0B] flex flex-col items-center justify-center p-4">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 h-px bg-white/6">
        <motion.div
          className="h-full bg-indigo-500"
          animate={{ width: analyzing ? "40%" : `${((step + 1) / STEPS.length) * 100}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>

      {/* Logo */}
      <div className="mb-8">
        <span className="font-heading font-bold text-2xl gradient-text">Hatch</span>
      </div>

      {/* Step indicators */}
      {!analyzing && (
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold transition-all ${
                i < step ? "bg-indigo-600 text-white" : i === step ? "bg-indigo-600/20 border border-indigo-500 text-indigo-400" : "bg-white/5 text-[#52525B]"
              }`}>
                {i < step ? <Check className="w-3 h-3" /> : i + 1}
              </div>
              <span className={`text-xs ${i === step ? "text-white" : "text-[#52525B]"}`}>{s}</span>
              {i < STEPS.length - 1 && <div className="w-6 h-px bg-white/10 mx-1" />}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">

        {/* ── Analyzing screen ── */}
        {analyzing && (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-lg"
          >
            <div className="bg-[#111114] border border-white/6 rounded-xl p-10 text-center">
              <div className="w-14 h-14 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Sparkles className="w-6 h-6 text-indigo-400 animate-pulse" />
              </div>
              <h1 className="font-heading text-xl font-semibold text-white mb-2">Analyse de votre app en cours…</h1>
              <p className="text-sm text-[#71717A] mb-6 max-w-xs mx-auto">
                Claude analyse votre app — ce qu'elle fait, vos clients cibles, les motivations d'achat — pour générer du contenu sur-mesure.
              </p>
              <div className="flex items-center justify-center gap-2 text-[#52525B] text-xs">
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyse en cours…
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Step 0: Profile ── */}
        {!analyzing && step === 0 && (
          <motion.div
            key="step-0"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-lg"
          >
            <div className="bg-[#111114] border border-white/6 rounded-xl p-8">
              <h1 className="font-heading text-2xl font-semibold text-white mb-1">Tell us about your app</h1>
              <p className="text-sm text-[#71717A] mb-6">We'll set up your account and analyse your app with AI</p>
              <form onSubmit={handleProfileSubmit} className="space-y-4">
                <div>
                  <label className="text-xs text-[#A1A1AA] mb-1.5 block">Your name</label>
                  <input value={profile.fullName} onChange={e => setProfile({...profile, fullName: e.target.value})} placeholder="Alex Johnson" required className="hatch-input" />
                </div>
                <div>
                  <label className="text-xs text-[#A1A1AA] mb-1.5 block">App name</label>
                  <input value={profile.appName} onChange={e => setProfile({...profile, appName: e.target.value})} placeholder="My SaaS App" required className="hatch-input" />
                </div>
                <div>
                  <label className="text-xs text-[#A1A1AA] mb-1.5 block">
                    App URL
                    <span className="ml-2 text-indigo-400 text-[10px] font-normal">← Claude analysera votre app automatiquement</span>
                  </label>
                  <input
                    type="text"
                    value={profile.appUrl}
                    onChange={e => setProfile({...profile, appUrl: e.target.value})}
                    onBlur={e => {
                      const v = e.target.value.trim()
                      if (v && !v.startsWith("http://") && !v.startsWith("https://")) {
                        setProfile(p => ({ ...p, appUrl: "https://" + v }))
                      }
                    }}
                    placeholder="resoly.lovable.app"
                    className="hatch-input"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A1A1AA] mb-1.5 block">Built with</label>
                  <select value={profile.platform} onChange={e => setProfile({...profile, platform: e.target.value})} className="hatch-input">
                    <option value="">Select platform</option>
                    {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <button type="submit" disabled={loading} className="hatch-btn-primary w-full mt-2">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {loading ? "Saving…" : "Continue →"}
                </button>
              </form>
            </div>
          </motion.div>
        )}

        {/* ── Step 1: Connect Stripe ── */}
        {!analyzing && step === 1 && (
          <motion.div
            key="step-1"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-lg"
          >
            <div className="bg-[#111114] border border-white/6 rounded-xl p-8 text-center">
              <div className="w-12 h-12 bg-indigo-600/10 border border-indigo-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                <StripeIcon />
              </div>
              <h1 className="font-heading text-2xl font-semibold text-white mb-2">Connect Stripe</h1>
              <p className="text-sm text-[#71717A] mb-6 max-w-sm mx-auto">
                You stay the merchant — Hatch collects 1% automatically via Stripe Connect. No fixed fees.
              </p>

              {stripeConnected ? (
                <div className="flex items-center justify-center gap-2 text-emerald-400 mb-6">
                  <Check className="w-4 h-4" />
                  <span className="text-sm font-medium">Connected · {stripeEmail}</span>
                </div>
              ) : (
                <button onClick={handleStripeConnect} className="hatch-btn-primary mx-auto mb-4 flex items-center gap-2">
                  <StripeIcon />
                  Connect Stripe Account
                  <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                </button>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep(0)} className="hatch-btn-secondary flex-1">← Back</button>
                <button onClick={() => setStep(2)} className="hatch-btn-primary flex-1">
                  {stripeConnected ? "Continue →" : "Skip for now →"}
                </button>
              </div>
              <p className="text-xs text-[#52525B] mt-4">You can connect Stripe later from Settings</p>
            </div>
          </motion.div>
        )}

        {/* ── Step 2: Create Plans ── */}
        {!analyzing && step === 2 && (
          <motion.div
            key="step-2"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-lg"
          >
            <div className="bg-[#111114] border border-white/6 rounded-xl p-8">
              <h1 className="font-heading text-2xl font-semibold text-white mb-1">Create your plans</h1>
              <p className="text-sm text-[#71717A] mb-6">Define what you want to charge</p>
              <form onSubmit={handlePlansSubmit} className="space-y-4">
                {plans.map((plan, i) => (
                  <div key={i} className="bg-white/3 border border-white/6 rounded-lg p-4 relative">
                    {plans.length > 1 && (
                      <button type="button" onClick={() => removePlan(i)} className="absolute top-3 right-3 text-[#52525B] hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-xs text-[#A1A1AA] mb-1 block">Plan name</label>
                        <input value={plan.name} onChange={e => updatePlan(i, "name", e.target.value)} className="hatch-input" placeholder="Pro" />
                      </div>
                      <div>
                        <label className="text-xs text-[#A1A1AA] mb-1 block">Monthly price ($)</label>
                        <input type="number" value={plan.price} onChange={e => updatePlan(i, "price", Number(e.target.value))} className="hatch-input font-mono" placeholder="19" min={0} />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-[#A1A1AA] mb-1 block">Features</label>
                      {plan.features.map((feat, fi) => (
                        <input key={fi} value={feat} onChange={e => updateFeature(i, fi, e.target.value)} className="hatch-input mb-1.5" placeholder="Feature description" />
                      ))}
                      <button type="button" onClick={() => addFeature(i)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 mt-1">
                        <Plus className="w-3 h-3" /> Add feature
                      </button>
                    </div>
                  </div>
                ))}

                <button type="button" onClick={addPlan} className="w-full border border-dashed border-white/10 hover:border-indigo-500/40 rounded-lg py-2.5 text-sm text-[#71717A] hover:text-indigo-400 transition-colors flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Add another plan
                </button>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setStep(1)} className="hatch-btn-secondary flex-1">← Back</button>
                  <button type="submit" disabled={loading} className="hatch-btn-primary flex-1">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Save plans →
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}

        {/* ── Step 3: Get Snippet ── */}
        {!analyzing && step === 3 && (
          <motion.div
            key="step-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-lg"
          >
            <div className="bg-[#111114] border border-white/6 rounded-xl p-8">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-indigo-600/10 border border-indigo-500/20 rounded-lg flex items-center justify-center">
                  <Zap className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <h1 className="font-heading text-xl font-semibold text-white">Add Hatch to your app</h1>
                  <p className="text-xs text-[#71717A]">One line of code</p>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-white/6 mb-4 gap-0">
                {(["html", "react", "lovable"] as const).map(tab => (
                  <button key={tab} onClick={() => setSnippetTab(tab)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    snippetTab === tab ? "border-indigo-500 text-white" : "border-transparent text-[#52525B] hover:text-[#A1A1AA]"
                  }`}>
                    {tab === "html" ? "HTML / Lovable" : tab === "react" ? "React / Next.js" : "Lovable"}
                  </button>
                ))}
              </div>

              <div className="relative bg-[#0A0A0B] border border-white/6 rounded-lg p-4 mb-4">
                <pre className="font-mono text-xs text-[#A1A1AA] overflow-x-auto whitespace-pre-wrap">
                  {snippetTab === "html" ? snippetHtml : snippetTab === "react" ? snippetReact : snippetLovable}
                </pre>
                <button onClick={copySnippet} className="absolute top-3 right-3 p-1.5 bg-white/5 hover:bg-white/10 rounded border border-white/10 transition-colors">
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[#71717A]" />}
                </button>
              </div>

              <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 mb-6">
                <p className="text-xs text-[#A1A1AA]">
                  <strong className="text-white">Your API key:</strong>{" "}
                  <code className="font-mono text-indigo-400">{apiKey}</code>
                </p>
              </div>

              {sdkDetected ? (
                <div className="flex items-center gap-2 text-emerald-400 mb-4 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-3">
                  <Check className="w-4 h-4" />
                  <span className="text-sm font-medium">SDK detected — you're good to go!</span>
                </div>
              ) : (
                <button onClick={testIntegration} className="hatch-btn-secondary w-full mb-4 flex items-center justify-center gap-2">
                  <Zap className="w-3.5 h-3.5" />
                  Test integration
                </button>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="hatch-btn-secondary flex-1">← Back</button>
                <button onClick={handleFinish} className="hatch-btn-primary flex-1">
                  Go to dashboard →
                </button>
              </div>
            </div>
          </motion.div>
        )}

      </AnimatePresence>

      <style jsx global>{`
        .hatch-input {
          width: 100%;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 14px;
          color: white;
          outline: none;
          transition: all 0.15s;
        }
        .hatch-input::placeholder { color: #52525B; }
        .hatch-input:focus { border-color: rgba(99,102,241,0.5); box-shadow: 0 0 0 1px rgba(99,102,241,0.3); }
        .hatch-input option { background: #111114; }
        .hatch-btn-primary {
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          background: #6366F1; color: white; border: none;
          padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.15s;
        }
        .hatch-btn-primary:hover { background: #5055E8; }
        .hatch-btn-primary:disabled { opacity: 0.5; cursor: default; }
        .hatch-btn-secondary {
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          background: rgba(255,255,255,0.05); color: #A1A1AA;
          border: 1px solid rgba(255,255,255,0.1);
          padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;
          cursor: pointer; transition: all 0.15s;
        }
        .hatch-btn-secondary:hover { background: rgba(255,255,255,0.08); color: white; }
      `}</style>
    </div>
  )
}

function StripeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="6" fill="#635BFF"/>
      <path d="M13.5 12.5c0-.9.7-1.3 1.8-1.3 1.6 0 3.6.5 5.2 1.4V8.5C18.9 7.5 17.2 7 15.3 7 11.5 7 9 9 9 12.5c0 5.5 7.5 4.6 7.5 7 0 1-.9 1.4-2.1 1.4-1.8 0-4.1-.8-5.9-1.8v4.1c2 .9 4 1.3 5.9 1.3 4 0 6.6-2 6.6-5.5-.1-5.9-7.5-4.9-7.5-7z" fill="white"/>
    </svg>
  )
}

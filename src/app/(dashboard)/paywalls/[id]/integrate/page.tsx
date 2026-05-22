"use client"

import { useEffect, useState, use } from "react"
import { createClient } from "@/lib/supabase/client"
import { motion, AnimatePresence } from "framer-motion"
import {
  ChevronLeft, Copy, Check, Loader2, Zap, AlertTriangle,
  CheckCircle2, ExternalLink, RefreshCw, Code2, Users,
  Activity, Sparkles, Globe, ChevronRight, Shield,
} from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { getSdkScriptUrl } from "@/lib/sdk-url"

// ─── Types ────────────────────────────────────────────────────────────────────

type IntegrationPoint = {
  location: string
  trigger_code: string
  context: string
}

type IntegrationResult = {
  integration_points: IntegrationPoint[]
  identify_snippet: string
  identify_context: string
  gating_suggestion: string
  test_steps: string[]
  confidence: "high" | "medium" | "low"
  notes: string
  paywall_id: string
  fetch_status: "ok" | "limited"
}

type SdkEvent = {
  id: string
  event: string
  created_at: string
  properties: Record<string, unknown> | null
}

type PaywallBasic = {
  id: string
  name: string
  headline: string | null
  status: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CodeBlock({ code, language = "html" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative group rounded-lg overflow-hidden border border-white/8 bg-[#0A0A0B]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/6 bg-white/2">
        <span className="text-[10px] text-[#52525B] font-mono">{language}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[10px] text-[#52525B] hover:text-[#A1A1AA] transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="p-3 text-[11px] font-mono text-indigo-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
        {code}
      </pre>
    </div>
  )
}

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${
      done ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" :
      active ? "bg-indigo-600 text-white" :
      "bg-white/5 text-[#52525B] border border-white/8"
    }`}>
      {done ? <Check className="w-3.5 h-3.5" /> : n}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function IntegratePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: paywallId } = use(params)
  const supabase = createClient()

  const [paywall, setPaywall] = useState<PaywallBasic | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [sdkLive, setSdkLive] = useState<boolean | null>(null) // null = checking
  const [currentStep, setCurrentStep] = useState(0)

  // Step 2 — AI analysis
  const [appUrl, setAppUrl] = useState("")
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<IntegrationResult | null>(null)

  // Step 5 — live events
  const [events, setEvents] = useState<SdkEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)

  const scriptSnippet = `<script async src="${getSdkScriptUrl()}" data-key="${apiKey || "pk_live_..."}"></script>`

  useEffect(() => { loadData() }, [paywallId])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: pw }, { data: profile }] = await Promise.all([
      supabase.from("paywalls").select("id, name, headline, status").eq("id", paywallId).single(),
      supabase.from("users").select("api_key, account_id").eq("id", user.id).single(),
    ])

    if (pw) setPaywall(pw as PaywallBasic)
    if (profile?.api_key) setApiKey(profile.api_key)

    // Check heartbeat
    if (profile?.account_id) {
      const { data: acct } = await supabase
        .from("accounts")
        .select("last_heartbeat_at")
        .eq("id", profile.account_id)
        .single()

      if (acct?.last_heartbeat_at) {
        const diff = Date.now() - new Date(acct.last_heartbeat_at).getTime()
        setSdkLive(diff < 30 * 60 * 1000) // live if heartbeat < 30 min ago
      } else {
        setSdkLive(false)
      }
    }
  }

  async function runAnalysis() {
    if (!appUrl.trim()) { toast.error("Enter your Lovable app URL"); return }
    setAnalyzing(true)
    setResult(null)
    try {
      const res = await fetch("/api/agent/integrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paywall_id: paywallId, app_url: appUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Analysis failed"); return }
      setResult(data as IntegrationResult)
      setCurrentStep(Math.max(currentStep, 2))
      toast.success("✨ Integration guide generated!")
    } catch { toast.error("Analysis failed") }
    finally { setAnalyzing(false) }
  }

  async function loadEvents() {
    setLoadingEvents(true)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from("events")
      .select("id, event, created_at, properties")
      .eq("paywall_id", paywallId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20)
    setEvents((data ?? []) as SdkEvent[])
    setLoadingEvents(false)
  }

  function relTime(iso: string) {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (m < 1) return "just now"
    if (m < 60) return `${m}m ago`
    return `${Math.floor(m / 60)}h ago`
  }

  const STEPS = [
    { label: "Install SDK", icon: Code2 },
    { label: "AI Analysis", icon: Sparkles },
    { label: "Add Triggers", icon: Zap },
    { label: "Sync Users", icon: Users },
    { label: "Verify", icon: Activity },
  ]

  const activeEvents = events.filter(e => e.event === "paywall_shown")

  return (
    <div className="min-h-screen bg-[#0A0A0B]">
      {/* Header */}
      <div className="border-b border-white/6 px-6 py-3 flex items-center gap-3">
        <Link href={`/paywalls/${paywallId}`} className="text-[#52525B] hover:text-white transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <div className="w-6 h-6 rounded-md bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
          <Zap className="w-3 h-3 text-indigo-400" />
        </div>
        <div>
          <span className="text-sm font-semibold text-white">Integration Wizard</span>
          {paywall && <span className="text-xs text-[#52525B] ml-2">— {paywall.name}</span>}
        </div>
        {sdkLive !== null && (
          <div className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border ${
            sdkLive
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${sdkLive ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            {sdkLive ? "SDK live" : "SDK not detected"}
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 flex gap-8">

        {/* Stepper sidebar */}
        <div className="w-48 flex-shrink-0">
          <div className="sticky top-8 space-y-1">
            {STEPS.map((step, i) => (
              <button
                key={i}
                onClick={() => setCurrentStep(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all ${
                  currentStep === i ? "bg-white/6 text-white" : "text-[#52525B] hover:text-[#A1A1AA] hover:bg-white/3"
                }`}
              >
                <StepDot n={i + 1} active={currentStep === i} done={
                  i === 0 ? sdkLive === true :
                  i === 1 ? result !== null :
                  i === 2 ? (result?.integration_points?.length ?? 0) > 0 :
                  i === 3 ? result !== null :
                  activeEvents.length > 0
                } />
                <div>
                  <p className={`text-[11px] font-medium ${currentStep === i ? "text-white" : ""}`}>{step.label}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">

            {/* ── Step 0: Install SDK ── */}
            {currentStep === 0 && (
              <motion.div key="step0" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <h2 className="text-lg font-bold text-white mb-1">Install the SDK</h2>
                <p className="text-sm text-[#71717A] mb-6">Add one script tag to your Lovable app. That&apos;s it.</p>

                <div className="space-y-6">
                  {/* Lovable-specific instructions */}
                  <div className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5">
                    <div className="flex items-center gap-2 mb-3">
                      <Globe className="w-4 h-4 text-indigo-400" />
                      <p className="text-sm font-semibold text-white">In Lovable</p>
                    </div>
                    <ol className="space-y-2">
                      {[
                        "Open your Lovable project",
                        "Go to Project Settings (top right gear icon)",
                        'Find "Custom Scripts" or "Head scripts"',
                        "Paste the snippet below and save",
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-xs text-[#A1A1AA]">
                          <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">{i + 1}</span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div>
                    <p className="text-xs text-[#71717A] mb-2 font-medium">Your install snippet</p>
                    <CodeBlock code={scriptSnippet} language="html" />
                  </div>

                  {/* SDK status */}
                  <div className={`flex items-start gap-3 p-3.5 rounded-lg border ${
                    sdkLive === true ? "border-emerald-500/20 bg-emerald-500/5" :
                    sdkLive === false ? "border-amber-500/20 bg-amber-500/5" :
                    "border-white/6 bg-white/2"
                  }`}>
                    {sdkLive === true ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    ) : sdkLive === false ? (
                      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-[#52525B] animate-spin flex-shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className={`text-xs font-medium ${
                        sdkLive === true ? "text-emerald-400" :
                        sdkLive === false ? "text-amber-400" : "text-[#71717A]"
                      }`}>
                        {sdkLive === true ? "SDK detected ✓" :
                         sdkLive === false ? "SDK not detected yet" : "Checking SDK status…"}
                      </p>
                      <p className="text-[11px] text-[#52525B] mt-0.5">
                        {sdkLive === true
                          ? "Your app is communicating with Hatch. You're good to go."
                          : "After pasting the snippet, reload your Lovable preview — it can take ~30 seconds."}
                      </p>
                    </div>
                    <button onClick={loadData} className="ml-auto text-[#52525B] hover:text-[#A1A1AA] transition-colors p-1">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="p-3 rounded-lg bg-white/3 border border-white/6">
                    <p className="text-[11px] text-[#71717A]">
                      <strong className="text-[#A1A1AA]">Debug tip:</strong> After pasting, open your app&apos;s browser console and type{" "}
                      <code className="font-mono text-indigo-400 bg-indigo-500/10 px-1 py-0.5 rounded">hatch.debug()</code>{" "}
                      to see the SDK status.
                    </p>
                  </div>

                  <button
                    onClick={() => setCurrentStep(1)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
                  >
                    Next: AI Analysis <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 1: AI Analysis ── */}
            {currentStep === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <h2 className="text-lg font-bold text-white mb-1">AI Analysis</h2>
                <p className="text-sm text-[#71717A] mb-6">
                  Paste your Lovable app URL — the AI will scan it and tell you exactly where to add{" "}
                  <code className="font-mono text-indigo-400 text-xs bg-indigo-500/10 px-1 py-0.5 rounded">hatch.show()</code>.
                </p>

                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input
                      value={appUrl}
                      onChange={e => setAppUrl(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && runAnalysis()}
                      placeholder="https://yourapp.lovable.app"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#52525B] outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                    />
                    <button
                      onClick={runAnalysis}
                      disabled={analyzing || !appUrl.trim()}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {analyzing ? "Analyzing…" : "Analyze"}
                    </button>
                  </div>

                  {analyzing && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-3 p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5"
                    >
                      <Loader2 className="w-5 h-5 text-indigo-400 animate-spin flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-white">Scanning your app…</p>
                        <p className="text-xs text-[#71717A] mt-0.5">Claude is reading your app and identifying the best integration points.</p>
                      </div>
                    </motion.div>
                  )}

                  {result && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-3"
                    >
                      {/* Confidence badge */}
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          result.confidence === "high" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                          result.confidence === "medium" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                          "bg-red-500/10 text-red-400 border-red-500/20"
                        }`}>
                          <Shield className="w-2.5 h-2.5" />
                          {result.confidence} confidence
                        </span>
                        {result.fetch_status === "limited" && (
                          <span className="text-[10px] text-[#52525B]">Page was login-gated — analysis based on URL + app description</span>
                        )}
                      </div>

                      {/* Integration points */}
                      <p className="text-xs font-semibold text-[#71717A] uppercase tracking-wide">
                        {result.integration_points.length} integration point{result.integration_points.length !== 1 ? "s" : ""} found
                      </p>
                      {result.integration_points.map((pt, i) => (
                        <div key={i} className="p-3.5 rounded-xl border border-white/6 bg-white/2">
                          <div className="flex items-start gap-2 mb-2">
                            <Zap className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                            <p className="text-xs font-semibold text-white">{pt.location}</p>
                          </div>
                          <p className="text-[11px] text-[#71717A] mb-2">{pt.context}</p>
                        </div>
                      ))}

                      {result.notes && (
                        <div className="p-3 rounded-lg bg-white/3 border border-white/6">
                          <p className="text-[11px] text-[#71717A]"><strong className="text-[#A1A1AA]">Notes:</strong> {result.notes}</p>
                        </div>
                      )}

                      <button
                        onClick={() => setCurrentStep(2)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
                      >
                        Next: See snippets <ChevronRight className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ── Step 2: Trigger snippets ── */}
            {currentStep === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <h2 className="text-lg font-bold text-white mb-1">Add Triggers</h2>
                <p className="text-sm text-[#71717A] mb-6">
                  Copy these snippets and paste them in your Lovable app where users should see the paywall.
                </p>

                <div className="space-y-5">
                  {result?.integration_points.length ? (
                    result.integration_points.map((pt, i) => (
                      <div key={i} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                          <p className="text-xs font-semibold text-white">{pt.location}</p>
                        </div>
                        <p className="text-[11px] text-[#71717A] ml-7">{pt.context}</p>
                        <div className="ml-7">
                          <CodeBlock code={pt.trigger_code} language="javascript" />
                        </div>
                      </div>
                    ))
                  ) : (
                    // Fallback if no AI result
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-white">Generic trigger — add to any button or link</p>
                      <CodeBlock code={`hatch.show('${paywallId}')`} language="javascript" />
                      <p className="text-[11px] text-[#52525B]">Example: <code className="font-mono text-indigo-400">&lt;button onclick="hatch.show(&apos;{paywallId}&apos;)"&gt;Upgrade&lt;/button&gt;</code></p>
                    </div>
                  )}

                  {/* HTML button example */}
                  <div>
                    <p className="text-xs text-[#71717A] mb-2 font-medium">HTML button example</p>
                    <CodeBlock code={`<button onclick="hatch.show('${paywallId}')">
  Upgrade to Pro
</button>`} language="html" />
                  </div>

                  <button
                    onClick={() => setCurrentStep(3)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
                  >
                    Next: User Sync <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 3: User sync ── */}
            {currentStep === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <h2 className="text-lg font-bold text-white mb-1">Sync Your Users</h2>
                <p className="text-sm text-[#71717A] mb-6">
                  Tell Hatch who the current user is so the paywall personalises correctly and subscription status is tracked.
                </p>

                <div className="space-y-6">
                  {/* Identify */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-indigo-400" />
                      <p className="text-xs font-semibold text-white">After user signs in</p>
                    </div>
                    {result?.identify_context && (
                      <p className="text-[11px] text-[#71717A] mb-2 ml-6">{result.identify_context}</p>
                    )}
                    <CodeBlock
                      code={result?.identify_snippet ?? `// Call this right after the user logs in:\nhatch.identify(user.id, { email: user.email })`}
                      language="javascript"
                    />
                  </div>

                  {/* Gating */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="w-4 h-4 text-indigo-400" />
                      <p className="text-xs font-semibold text-white">Gate a premium feature <span className="text-[#52525B] font-normal">(optional)</span></p>
                    </div>
                    <p className="text-[11px] text-[#71717A] mb-2 ml-6">
                      Use this to programmatically block access to premium content.
                    </p>
                    <CodeBlock
                      code={result?.gating_suggestion ?? `// Block access to a premium feature:\nif (!await hatch.isSubscribed()) {\n  hatch.show('${paywallId}')\n  return\n}`}
                      language="javascript"
                    />
                  </div>

                  {/* After sign-out */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-xs font-semibold text-white">After user signs out</p>
                    </div>
                    <CodeBlock code={`hatch.reset() // clears the cached user identity`} language="javascript" />
                  </div>

                  <button
                    onClick={() => { setCurrentStep(4); loadEvents() }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
                  >
                    Next: Verify <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 4: Verify ── */}
            {currentStep === 4 && (
              <motion.div key="step4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <h2 className="text-lg font-bold text-white mb-1">Verify Integration</h2>
                <p className="text-sm text-[#71717A] mb-6">
                  Test that everything is working end-to-end.
                </p>

                <div className="space-y-6">
                  {/* Test steps */}
                  {(result?.test_steps ?? [
                    "Open your Lovable app preview",
                    "Open the browser console (F12)",
                    "Type hatch.debug() to confirm SDK is loaded",
                    "Click the button where you added hatch.show() to trigger the paywall",
                    "The paywall should appear — if it does, you're done!",
                  ]).map((step, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-indigo-500/15 text-indigo-400 flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                      <p className="text-sm text-[#A1A1AA]">{step}</p>
                    </div>
                  ))}

                  {/* Debug snippet */}
                  <div>
                    <p className="text-xs text-[#71717A] mb-2 font-medium">Debug command (paste in browser console)</p>
                    <CodeBlock code="hatch.debug()" language="javascript" />
                  </div>

                  {/* Live events feed */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-[#71717A] uppercase tracking-wide">Live events (last 24h)</p>
                      <button onClick={loadEvents} disabled={loadingEvents} className="text-[#52525B] hover:text-[#A1A1AA] transition-colors">
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingEvents ? "animate-spin" : ""}`} />
                      </button>
                    </div>

                    {activeEvents.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/8 border border-emerald-500/20 mb-3"
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        <p className="text-xs font-semibold text-emerald-400">Integration active! Paywall shown {activeEvents.length} time{activeEvents.length !== 1 ? "s" : ""} in the last 24h.</p>
                      </motion.div>
                    )}

                    {loadingEvents ? (
                      <div className="flex items-center gap-2 py-4 text-[#52525B] text-xs">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading events…
                      </div>
                    ) : events.length === 0 ? (
                      <div className="py-6 text-center text-[#52525B] text-xs border border-white/6 rounded-lg">
                        <Activity className="w-6 h-6 mx-auto mb-2 opacity-30" />
                        No events yet. Trigger the paywall in your app to see them here.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {events.slice(0, 10).map(ev => (
                          <div key={ev.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/2 border border-white/5">
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              ev.event === "paywall_shown" ? "bg-indigo-400" :
                              ev.event === "payment_success" ? "bg-emerald-400" :
                              ev.event === "plan_selected" ? "bg-amber-400" :
                              "bg-[#52525B]"
                            }`} />
                            <span className="text-[11px] font-mono text-[#A1A1AA] flex-1">{ev.event}</span>
                            <span className="text-[10px] text-[#52525B]">{relTime(ev.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Go to paywall link */}
                  <Link
                    href={`/paywalls/${paywallId}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-[#A1A1AA] hover:text-white hover:bg-white/8 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Back to paywall builder
                  </Link>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

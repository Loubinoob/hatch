"use client"

import { useState, useMemo, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Copy, Check, Zap, Terminal, ChevronDown, ChevronUp, ExternalLink, Wifi, WifiOff, Code2, MessageSquare, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"

// ─── Types ────────────────────────────────────────────────────────────────────

type Paywall = { id: string; name: string; status: string }

type Props = {
  apiKey: string
  sdkScriptUrl: string
  paywalls: Paywall[]
  lastHeartbeat: string | null
}

type Platform = "lovable" | "bolt" | "cursor" | "replit"

// ─── Platform config ──────────────────────────────────────────────────────────

const PLATFORMS: { id: Platform; label: string; emoji: string; scriptInstruction: string }[] = [
  {
    id: "lovable",
    label: "Lovable",
    emoji: "🪄",
    scriptInstruction: "in Lovable → click the settings icon (⚙) → Custom Scripts → paste in the \"Head\" section",
  },
  {
    id: "bolt",
    label: "Bolt",
    emoji: "⚡",
    scriptInstruction: "in the <head> section of your index.html file",
  },
  {
    id: "cursor",
    label: "Cursor",
    emoji: "🖱️",
    scriptInstruction: "in the <head> section of your root HTML file",
  },
  {
    id: "replit",
    label: "Replit",
    emoji: "🔁",
    scriptInstruction: "in the <head> section of your index.html file",
  },
]

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(sdkScriptUrl: string, apiKey: string, paywall: Paywall | null, platform: Platform): string {
  const p = PLATFORMS.find(x => x.id === platform)!
  const scriptTag = `<script async src="${sdkScriptUrl}" data-key="${apiKey}"></script>`
  const paywallLine = paywall
    ? `hatch.show('${paywall.id}')`
    : `hatch.show('YOUR_PAYWALL_ID') // replace with your paywall ID from hatch dashboard`

  return `Please integrate Hatch paywall into my app. Here are the exact steps:

1. Add this script tag ${p.scriptInstruction}:

${scriptTag}

2. After a user signs in or signs up successfully, add this line right after the login confirmation:

hatch.identify(user.id, { email: user.email })

(replace user.id and user.email with the real values from your auth system)

3. On the main "Upgrade", "Go Pro", or premium CTA button in the app, add:

${paywallLine}

That's it — no npm package needed, no build step. The paywall will appear automatically, already styled to match your app.`
}

// ─── Code block with copy ─────────────────────────────────────────────────────

function CodeSnippet({ code, lang = "javascript" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="relative group rounded-lg bg-[#0A0A0B] border border-white/6 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/6">
        <span className="text-[10px] text-[#52525B] font-mono uppercase">{lang}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[10px] text-[#52525B] hover:text-white transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono text-[#A1A1AA] overflow-x-auto leading-relaxed">{code}</pre>
    </div>
  )
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function ManualSection({ title, desc, code, lang }: { title: string; desc: string; code: string; lang: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-white/6 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors"
      >
        <div className="text-left">
          <p className="text-sm font-medium text-white">{title}</p>
          <p className="text-xs text-[#71717A] mt-0.5">{desc}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-[#52525B] flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-[#52525B] flex-shrink-0" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              <CodeSnippet code={code} lang={lang} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function IntegrateClient({ apiKey, sdkScriptUrl, paywalls, lastHeartbeat }: Props) {
  const [tab, setTab] = useState<"ai" | "manual">("ai")
  const [platform, setPlatform] = useState<Platform>("lovable")

  // Only show live paywalls in the dropdown
  const livePaywalls = paywalls.filter(p => p.status === "live")
  const [selectedId, setSelectedId] = useState<string>(livePaywalls[0]?.id ?? "")
  const [publishing, setPublishing] = useState(false)
  const [copying, setCopying] = useState(false)
  const [sdkLive, setSdkLive] = useState(() => {
    if (!lastHeartbeat) return false
    return Date.now() - new Date(lastHeartbeat).getTime() < 5 * 60 * 1000
  })

  // Poll heartbeat every 15s
  useEffect(() => {
    const supabase = createClient()
    async function checkHeartbeat() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
      if (!profile?.account_id) return
      const { data: account } = await supabase.from("accounts").select("last_heartbeat_at").eq("id", profile.account_id).single()
      if (account?.last_heartbeat_at) {
        setSdkLive(Date.now() - new Date(account.last_heartbeat_at).getTime() < 5 * 60 * 1000)
      }
    }
    const interval = setInterval(checkHeartbeat, 15000)
    return () => clearInterval(interval)
  }, [])

  const selectedPaywall = livePaywalls.find(p => p.id === selectedId) ?? null
  const prompt = useMemo(
    () => buildPrompt(sdkScriptUrl, apiKey, selectedPaywall, platform),
    [sdkScriptUrl, apiKey, selectedPaywall, platform]
  )

  async function publishPaywall(paywallId: string) {
    setPublishing(true)
    const supabase = createClient()
    const { error } = await supabase.from("paywalls").update({ status: "live" }).eq("id", paywallId)
    if (error) {
      toast.error("Failed to publish paywall")
    } else {
      toast.success("Paywall published! 🎉")
      // Refresh — move it to selectedId
      setSelectedId(paywallId)
      window.location.reload()
    }
    setPublishing(false)
  }

  function copyPrompt() {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopying(true)
      toast.success("Message copied! Now paste it in your AI builder chat 🚀")
      setTimeout(() => setCopying(false), 3000)
    })
  }

  const scriptSnippet = `<script async src="${sdkScriptUrl}"\n  data-key="${apiKey}"></script>`
  const identifySnippet = `// Call this right after the user logs in:\nhatch.identify(user.id, { email: user.email })`
  const showSnippet = selectedPaywall
    ? `// On your upgrade / premium CTA button:\nhatch.show('${selectedPaywall.id}')`
    : livePaywalls.length === 0
      ? `// Publish a paywall first, then come back here for your ID`
      : `// On your upgrade / premium CTA button:\nhatch.show('YOUR_PAYWALL_ID')`
  const debugSnippet = `// In your browser console to check SDK status:\nhatch.debug()`

  // Warning: no live paywalls
  const noLivePaywalls = livePaywalls.length === 0

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white">
      <div className="max-w-2xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-indigo-500/15 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-indigo-400" />
            </div>
            <span className="text-xs font-medium text-indigo-400 uppercase tracking-wider">Quick Install</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Add Hatch to your app</h1>
          <p className="text-[#71717A] text-sm">
            No coding required — copy one message and paste it in your AI builder&apos;s chat.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-white/4 rounded-xl mb-8 w-fit">
          <button
            onClick={() => setTab("ai")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "ai" ? "bg-white/8 text-white" : "text-[#71717A] hover:text-[#A1A1AA]"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            AI Builder
          </button>
          <button
            onClick={() => setTab("manual")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "manual" ? "bg-white/8 text-white" : "text-[#71717A] hover:text-[#A1A1AA]"
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Manual
          </button>
        </div>

        <AnimatePresence mode="wait">
          {tab === "ai" ? (
            <motion.div
              key="ai"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-6"
            >
              {/* 3-step visual */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { emoji: "📋", title: "Copy the message", sub: "Pre-filled with your keys" },
                  { emoji: "💬", title: "Open your AI builder", sub: "Lovable, Bolt, Cursor…" },
                  { emoji: "✅", title: "Paste & send", sub: "Your AI handles the rest" },
                ].map(s => (
                  <div key={s.title} className="bg-white/3 border border-white/6 rounded-xl p-4 text-center">
                    <div className="text-2xl mb-2">{s.emoji}</div>
                    <p className="text-xs font-semibold text-white mb-0.5">{s.title}</p>
                    <p className="text-[11px] text-[#52525B]">{s.sub}</p>
                  </div>
                ))}
              </div>

              {/* Platform selector */}
              <div>
                <p className="text-xs text-[#71717A] mb-2 font-medium">Which AI builder are you using?</p>
                <div className="flex gap-2 flex-wrap">
                  {PLATFORMS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setPlatform(p.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        platform === p.id
                          ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
                          : "bg-white/3 border-white/6 text-[#71717A] hover:text-[#A1A1AA] hover:bg-white/5"
                      }`}
                    >
                      <span>{p.emoji}</span>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Paywall selector — live only */}
              {noLivePaywalls ? (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-300">No live paywall yet</p>
                    <p className="text-xs text-[#71717A] mt-0.5">
                      You need to{" "}
                      <a href="/paywalls" className="text-indigo-400 hover:underline">create and publish a paywall</a>
                      {" "}before integrating — drafts won&apos;t show in your app.
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs text-[#71717A] mb-2 font-medium">Which paywall should trigger?</p>
                  <select
                    value={selectedId}
                    onChange={e => setSelectedId(e.target.value)}
                    className="w-full bg-[#111114] border border-white/6 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors"
                  >
                    {livePaywalls.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ✓ live
                      </option>
                    ))}
                  </select>
                  {/* Draft paywalls not shown — explain why */}
                  {paywalls.filter(p => p.status !== "live").map(p => (
                    <div key={p.id} className="mt-2 flex items-start gap-2 text-[11px] text-[#52525B]">
                      <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-500/70 flex-shrink-0" />
                      <span>
                        &ldquo;{p.name}&rdquo; is a draft — drafts don&apos;t show in your app.{" "}
                        <button
                          onClick={() => publishPaywall(p.id)}
                          disabled={publishing}
                          className="text-indigo-400 hover:underline disabled:opacity-50"
                        >
                          Publish it now
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* The prompt */}
              <div className="bg-[#0D0D0F] border border-white/8 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/6">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-xs font-semibold text-white">Your install message</span>
                  </div>
                  <span className="text-[10px] text-[#52525B]">pre-filled with your keys</span>
                </div>
                <pre className="px-4 py-4 text-xs font-mono text-[#A1A1AA] leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
                  {prompt}
                </pre>
              </div>

              {/* Copy button */}
              <button
                onClick={copyPrompt}
                disabled={noLivePaywalls}
                className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm transition-all ${
                  copying
                    ? "bg-emerald-600 text-white"
                    : noLivePaywalls
                      ? "bg-white/5 text-[#52525B] cursor-not-allowed"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white"
                }`}
              >
                {copying ? (
                  <><Check className="w-4 h-4" /> Copied! Paste it in your AI chat</>
                ) : (
                  <><Copy className="w-4 h-4" /> Copy this message</>
                )}
              </button>

              {/* SDK status */}
              <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm ${
                sdkLive
                  ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
                  : "bg-white/3 border-white/6 text-[#52525B]"
              }`}>
                {sdkLive ? (
                  <>
                    <Wifi className="w-4 h-4 flex-shrink-0" />
                    <div>
                      <span className="font-medium">SDK detected!</span>
                      <span className="text-xs ml-2 opacity-70">Your app is connected to Hatch</span>
                    </div>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4 flex-shrink-0 animate-pulse" />
                    <div>
                      <span className="font-medium text-[#71717A]">Waiting for SDK…</span>
                      <span className="text-xs ml-2 opacity-70">Will appear here once the script is loaded in your app</span>
                    </div>
                  </>
                )}
              </div>

              {/* Lovable quick tip */}
              {platform === "lovable" && (
                <div className="flex items-start gap-3 bg-white/3 border border-white/6 rounded-xl p-4">
                  <span className="text-lg mt-0.5">💡</span>
                  <div className="text-xs text-[#71717A] leading-relaxed">
                    <span className="text-white font-medium">Lovable tip:</span> In your project, click the settings icon (⚙) in the top bar → scroll to{" "}
                    <span className="text-white font-medium">Custom Scripts</span> → paste the script tag in the{" "}
                    <span className="text-white font-medium">Head</span> section.{" "}
                    Or just paste the whole message above in the Lovable chat and let the AI handle it.
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="manual"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-3"
            >
              <p className="text-xs text-[#52525B] mb-4">
                Each step is independent — expand and copy what you need.
              </p>

              <ManualSection
                title="1. Load the SDK"
                desc="Paste once in your app's <head>"
                code={scriptSnippet}
                lang="html"
              />

              <ManualSection
                title="2. Identify users"
                desc="Call after a successful login or signup"
                code={identifySnippet}
                lang="javascript"
              />

              <ManualSection
                title="3. Show the paywall"
                desc="Call on your upgrade / premium CTA"
                code={showSnippet}
                lang="javascript"
              />

              {/* Paywall selector for manual */}
              {livePaywalls.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs text-[#71717A] mb-2">Change target paywall:</p>
                  <select
                    value={selectedId}
                    onChange={e => setSelectedId(e.target.value)}
                    className="w-full bg-[#111114] border border-white/6 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors"
                  >
                    {livePaywalls.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ✓ live
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {noLivePaywalls && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-300">No live paywall yet</p>
                    <p className="text-xs text-[#71717A] mt-0.5">
                      <a href="/paywalls" className="text-indigo-400 hover:underline">Publish a paywall first</a>
                      {" "}— then the paywall ID will appear in the snippet above.
                    </p>
                  </div>
                </div>
              )}

              {/* Debug section */}
              <div className="mt-6 pt-6 border-t border-white/6">
                <div className="flex items-center gap-2 mb-3">
                  <Terminal className="w-3.5 h-3.5 text-[#52525B]" />
                  <p className="text-xs font-medium text-[#71717A]">Debug</p>
                </div>
                <CodeSnippet code={debugSnippet} lang="javascript" />
                <p className="text-[11px] text-[#52525B] mt-2">
                  Open your browser console (F12) and run this to verify the SDK is loaded and configured correctly.
                </p>
              </div>

              {/* SDK status */}
              <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm mt-4 ${
                sdkLive
                  ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
                  : "bg-white/3 border-white/6 text-[#52525B]"
              }`}>
                {sdkLive ? (
                  <>
                    <Wifi className="w-4 h-4 flex-shrink-0" />
                    <span className="font-medium">SDK detected — your app is connected</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4 flex-shrink-0 animate-pulse" />
                    <span className="font-medium text-[#71717A]">Waiting for SDK…</span>
                  </>
                )}
              </div>

              <a
                href="https://github.com/Loubinoob/hatch"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-indigo-400 transition-colors mt-2"
              >
                <ExternalLink className="w-3 h-3" />
                View full documentation
              </a>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  )
}

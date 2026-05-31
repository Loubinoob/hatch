"use client"

// ─────────────────────────────────────────────────────────────────────────────
// Internal design sandbox (dev tool, NOT the product). Renders the REAL block
// renderer with sample data across every template + theme preset + light/dark,
// so we can iterate on aesthetics without Supabase/auth. Safe to expose: it only
// renders hardcoded sample content.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react"
import { Monitor, Smartphone, Sun, Moon } from "lucide-react"
import BlocksPreview from "@/components/blocks/BlocksPreview"
import { PAYWALL_TEMPLATES } from "@/lib/blocks/templates"
import { BLOCK_DEFINITIONS, BLOCK_PICKER_ORDER } from "@/lib/blocks/definitions"
import { makeBlock } from "@/lib/blocks/utils"
import { THEME_PRESETS, resolveTheme } from "@/lib/blocks/theme"
import type { Block, BlockTheme, ColorScheme, DisplayMode } from "@/lib/blocks/types"

const SAMPLE_PLANS = [
  { id: "starter", name: "Starter", price_monthly: 0, price_yearly: 0, features: ["3 projects", "Community support", "Basic analytics"], is_popular: false },
  { id: "pro", name: "Pro", price_monthly: 1500, price_yearly: 14400, features: ["Unlimited projects", "Priority support", "Advanced analytics", "API access"], is_popular: true },
  { id: "team", name: "Team", price_monthly: 4900, price_yearly: 47000, features: ["Everything in Pro", "10 team seats", "SSO & SAML", "Audit logs"], is_popular: false },
]

const allBlocks: Block[] = BLOCK_PICKER_ORDER.map(type => makeBlock(type, { ...BLOCK_DEFINITIONS[type].defaultProps }))

type Entry = { id: string; name: string; tone: string; displayMode: DisplayMode; theme: Partial<BlockTheme>; blocks: Block[] }

const ENTRIES: Entry[] = [
  { id: "__all", name: "All blocks (audit)", tone: "Every block type once", displayMode: "fullscreen", theme: { accentColor: "#6366F1" }, blocks: allBlocks },
  ...PAYWALL_TEMPLATES.map(t => ({ id: t.id, name: t.name, tone: t.tone, displayMode: t.displayMode, theme: t.theme, blocks: t.blocks })),
]

export default function SandboxPage() {
  const [activeId, setActiveId] = useState(ENTRIES[0].id)
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop")
  const [scheme, setScheme] = useState<ColorScheme>("dark")
  const [presetId, setPresetId] = useState("__template")

  const entry = useMemo(() => ENTRIES.find(e => e.id === activeId) ?? ENTRIES[0], [activeId])

  // Theme = template default OR chosen preset, with the scheme toggle applied on top.
  const theme: Partial<BlockTheme> = useMemo(() => {
    const preset = THEME_PRESETS.find(p => p.id === presetId)
    const base = preset ? preset.theme : entry.theme
    return { accentColor: "#6366F1", fontFamily: "system", buttonShape: "rounded", overlayOpacity: 65, ...base, colorScheme: scheme }
  }, [presetId, entry, scheme])

  const t = resolveTheme(theme)

  return (
    <div className="flex h-screen bg-[#0A0A0B] text-white">
      {/* Left rail */}
      <div className="w-[240px] flex-shrink-0 border-r border-white/8 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <p className="text-sm font-semibold">Design sandbox</p>
          <p className="text-[11px] text-[#71717A]">Internal · live renderer · sample data</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {ENTRIES.map(e => (
            <button key={e.id} onClick={() => setActiveId(e.id)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${activeId === e.id ? "bg-white/8" : "hover:bg-white/4"}`}>
              <span className="block text-[12px] font-medium text-white">{e.name}</span>
              <span className="block text-[10px] text-[#71717A]">{e.tone}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Stage */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/8 flex-wrap">
          <span className="text-[13px] font-semibold">{entry.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[#71717A] capitalize">{entry.displayMode}</span>
          <div className="flex-1" />

          {/* preset selector */}
          <select value={presetId} onChange={e => setPresetId(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg text-[11px] px-2 py-1.5 text-white outline-none">
            <option value="__template">Template default</option>
            {THEME_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {/* scheme toggle */}
          <div className="flex rounded-lg border border-white/8 overflow-hidden">
            {([{ key: "light", icon: Sun }, { key: "dark", icon: Moon }] as const).map(({ key, icon: Icon }) => (
              <button key={key} onClick={() => setScheme(key)}
                className={`px-2.5 py-1.5 transition-colors ${scheme === key ? "bg-white/8 text-white" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>

          {/* device toggle */}
          <div className="flex rounded-lg border border-white/8 overflow-hidden">
            {([{ key: "desktop", icon: Monitor }, { key: "mobile", icon: Smartphone }] as const).map(({ key, icon: Icon }) => (
              <button key={key} onClick={() => setDevice(key)}
                className={`px-2.5 py-1.5 transition-colors ${device === key ? "bg-white/8 text-white" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto flex items-center justify-center p-6">
          <div className="rounded-2xl border border-white/8 overflow-hidden shadow-2xl flex-shrink-0"
            style={device === "mobile" ? { width: 390, height: 800 } : { width: "min(1040px, 100%)", height: "min(720px, 100%)" }}>
            <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/6 bg-[#1a1a1e]">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
              <div className="flex-1 bg-white/5 rounded-full h-5 mx-2 flex items-center px-3">
                <span className="text-[10px] text-[#52525B]">myapp.lovable.app</span>
              </div>
            </div>
            {/* Stage backdrop reflects the resolved page background so light themes read correctly */}
            <div className="relative h-[calc(100%-40px)] overflow-hidden" style={{ background: t.pageGradient ?? t.pageBg }}>
              <BlocksPreview blocks={entry.blocks} plans={SAMPLE_PLANS} theme={theme} displayMode={entry.displayMode} device={device} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

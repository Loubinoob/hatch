"use client"

import { use, useEffect, useState, useCallback } from "react"
import { Loader2, Monitor, Smartphone, RefreshCw, ArrowLeft, AlertCircle, Sun, Moon } from "lucide-react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { withDefaults } from "@/lib/paywall-resilience"
import BlocksPreview from "@/components/blocks/BlocksPreview"
import PaywallPreview from "@/components/paywall/PaywallPreview"
import { resolveTheme } from "@/lib/blocks/theme"
import type { Block, BlockTheme, ColorScheme, DisplayMode } from "@/lib/blocks/types"

type Plan = {
  id: string
  name: string
  price_monthly: number
  price_yearly: number
  features: string[]
  is_popular: boolean
}

/** Snapshot stashed by the builder when "Aperçu" is clicked — reflects unsaved edits. */
type PreviewSnapshot = {
  id: string
  savedAt: number
  name: string
  blocks: Block[]
  plans: Plan[]
  theme: Partial<BlockTheme>
  displayMode: DisplayMode
  config: Record<string, unknown>
}

const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 30 // 30 min — older snapshots are ignored in favour of DB

export default function PaywallPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()

  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null)
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop")
  const [schemeOverride, setSchemeOverride] = useState<ColorScheme | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<"editor" | "saved">("saved")

  // ── Build a snapshot from the database (fallback / direct visits) ──────────────
  const loadFromDb = useCallback(async (): Promise<PreviewSnapshot | null> => {
    const { data: pw } = await supabase.from("paywalls").select("*").eq("id", id).single()
    if (!pw) return null

    const cfg = withDefaults({ ...pw }) as Record<string, unknown>

    // Prefer the plans attached to this paywall; fall back to the account's active plans.
    let plans: Plan[] = []
    const planIds = (pw.plan_ids as string[] | null) ?? []
    if (planIds.length > 0) {
      const { data } = await supabase.from("plans").select("*").in("id", planIds)
      plans = (data ?? []) as Plan[]
    }
    if (plans.length === 0) {
      const { data } = await supabase
        .from("plans")
        .select("*")
        .eq("account_id", pw.account_id)
        .eq("is_active", true)
        .order("price_monthly", { ascending: true })
      plans = (data ?? []) as Plan[]
    }
    plans = plans.slice().sort((a, b) => (a.price_monthly ?? 0) - (b.price_monthly ?? 0)).slice(0, 3)

    const design = (cfg.design as Record<string, string> | null) ?? {}
    return {
      id,
      savedAt: 0,
      name: (cfg.name as string) ?? "Paywall",
      blocks: (cfg.blocks as Block[]) ?? [],
      plans,
      theme: {
        accentColor: design.accentColor ?? "#6366F1",
        fontFamily: (cfg.font_family as BlockTheme["fontFamily"]) ?? "system",
        buttonShape: (cfg.button_shape as BlockTheme["buttonShape"]) ?? "rounded",
        overlayOpacity: (cfg.overlay_opacity as number) ?? 65,
        colorScheme: (design.colorScheme as BlockTheme["colorScheme"]) ?? "dark",
        background: design.background || undefined,
        backgroundGradient: design.backgroundGradient || undefined,
        surface: design.surface || undefined,
        textColor: design.textColor || undefined,
      },
      displayMode: (cfg.display_mode as DisplayMode) ?? "modal",
      config: cfg,
    }
  }, [id, supabase])

  // ── Resolve the preview source: fresh editor snapshot → else DB ────────────────
  // Pure-ish: reads localStorage + DB but never touches React state, so it is safe
  // to await inside an effect without tripping set-state-in-effect.
  const computeSnapshot = useCallback(async (): Promise<
    | { ok: true; snapshot: PreviewSnapshot; source: "editor" | "saved" }
    | { ok: false; error: string }
  > => {
    let editorSnap: PreviewSnapshot | null = null
    try {
      const raw = localStorage.getItem(`hatch-preview-${id}`)
      if (raw) {
        const parsed = JSON.parse(raw) as PreviewSnapshot
        if (parsed?.id === id && Date.now() - (parsed.savedAt ?? 0) < SNAPSHOT_MAX_AGE_MS) {
          editorSnap = parsed
        }
      }
    } catch { /* ignore malformed snapshot */ }

    if (editorSnap) return { ok: true, snapshot: editorSnap, source: "editor" }

    try {
      const fromDb = await loadFromDb()
      if (!fromDb) return { ok: false, error: "Paywall introuvable." }
      return { ok: true, snapshot: fromDb, source: "saved" }
    } catch {
      return { ok: false, error: "Impossible de charger l'aperçu." }
    }
  }, [id, loadFromDb])

  const apply = useCallback((r: Awaited<ReturnType<typeof computeSnapshot>>) => {
    if (r.ok) { setSnapshot(r.snapshot); setSource(r.source); setError(null) }
    else { setError(r.error) }
    setLoading(false)
  }, [])

  // Initial load — all state updates happen after an await, never synchronously.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await computeSnapshot()
      if (!cancelled) apply(r)
    })()
    return () => { cancelled = true }
  }, [computeSnapshot, apply])

  // Manual refresh (event handler — synchronous setState is fine here).
  async function refresh() {
    setLoading(true)
    apply(await computeSnapshot())
  }

  const accent = snapshot?.theme.accentColor ?? "#6366F1"
  const hasBlocks = (snapshot?.blocks?.length ?? 0) > 0

  // Optional light/dark override for previewing both appearances on the fly.
  const effectiveTheme = snapshot
    ? { ...snapshot.theme, ...(schemeOverride ? { colorScheme: schemeOverride } : {}) }
    : { accentColor: accent }
  const stage = resolveTheme(effectiveTheme)

  return (
    <div className="flex flex-col h-screen bg-[#0A0A0B] text-white">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/8 flex-shrink-0">
        <Link
          href={`/paywalls/${id}`}
          className="flex items-center gap-1 text-[12px] text-[#A1A1AA] hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Éditeur
        </Link>
        <div className="h-4 w-px bg-white/10" />
        <span className="text-[13px] font-semibold truncate max-w-[280px]">
          {snapshot?.name || "Aperçu"}
        </span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            source === "editor"
              ? "bg-indigo-500/15 text-indigo-300"
              : "bg-white/5 text-[#71717A]"
          }`}
        >
          {source === "editor" ? "Brouillon (éditeur)" : "Version enregistrée"}
        </span>

        <div className="flex-1" />

        {/* Appearance override */}
        <div className="flex rounded-lg border border-white/8 overflow-hidden">
          {([
            { key: "light", icon: Sun },
            { key: "dark", icon: Moon },
          ] as const).map(({ key, icon: Icon }) => {
            const active = (schemeOverride ?? snapshot?.theme.colorScheme ?? "dark") === key
            return (
              <button
                key={key}
                onClick={() => setSchemeOverride(key)}
                className={`px-2.5 py-1.5 transition-colors ${active ? "bg-white/8 text-white" : "text-[#52525B] hover:text-[#A1A1AA]"}`}
                title={key === "light" ? "Clair" : "Sombre"}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            )
          })}
        </div>

        {/* Device toggle */}
        <div className="flex rounded-lg border border-white/8 overflow-hidden">
          {([
            { key: "desktop", icon: Monitor, label: "Bureau" },
            { key: "mobile", icon: Smartphone, label: "Mobile" },
          ] as const).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setDevice(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                device === key ? "bg-white/8 text-white" : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/4 border border-white/8 hover:bg-white/8 text-[11px] text-[#A1A1AA] hover:text-white transition-colors"
          title="Recharger l'aperçu depuis l'éditeur"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Rafraîchir
        </button>
      </div>

      {/* Stage */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-6">
        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
        ) : error ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <AlertCircle className="w-6 h-6 text-red-400" />
            <p className="text-sm text-[#A1A1AA]">{error}</p>
            <Link href={`/paywalls/${id}`} className="text-xs text-indigo-400 hover:text-indigo-300 mt-1">
              Retour à l&apos;éditeur →
            </Link>
          </div>
        ) : snapshot ? (
          <div
            className="rounded-2xl border border-white/8 overflow-hidden shadow-2xl flex-shrink-0 transition-[width,height] duration-300"
            style={
              device === "mobile"
                ? { width: 390, height: 800 }
                : { width: "min(1040px, 100%)", height: "min(700px, 100%)" }
            }
          >
            {/* Host browser/phone chrome */}
            <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/6 bg-[#1a1a1e]">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
              <div className="flex-1 bg-white/5 rounded-full h-5 mx-2 flex items-center px-3">
                <span className="text-[10px] text-[#52525B]">myapp.lovable.app</span>
              </div>
            </div>
            {/* Faux host page behind the paywall, so a modal overlay reads correctly */}
            <div className="relative h-[calc(100%-40px)] overflow-hidden" style={{ background: stage.pageGradient ?? stage.pageBg }}>
              {hasBlocks ? (
                <BlocksPreview
                  blocks={snapshot.blocks}
                  plans={snapshot.plans}
                  theme={effectiveTheme}
                  displayMode={snapshot.displayMode}
                  device={device}
                  currency={(snapshot.config?.currency as string) ?? "USD"}
                />
              ) : (
                <PaywallPreview
                  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                  config={snapshot.config as any}
                  plans={snapshot.plans}
                  accentColor={accent}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

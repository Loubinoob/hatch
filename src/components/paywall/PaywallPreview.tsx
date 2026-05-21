"use client"

import { useState } from "react"
import { Check, X, Shield, Star, Zap } from "lucide-react"

type Plan = {
  id: string
  name: string
  price_monthly: number
  price_yearly: number
  features: string[]
  is_popular: boolean
}

interface Config {
  headline?: string
  subheadline?: string | null
  body_copy?: string | null
  cta_copy?: string
  social_proof?: string | null
  social_proof_type?: "text" | "stars" | "user_count" | "none"
  footer_text?: string | null
  guarantee_text?: string | null
  urgency_text?: string | null
  trust_badges?: string[]
  show_yearly_toggle?: boolean
  closeable?: boolean
  template?: string
  font_family?: "system" | "serif" | "mono"
  button_shape?: "rounded" | "pill" | "square"
  overlay_opacity?: number
  yearly_discount_percent?: number
  currency?: string
}

interface Props {
  config: Config
  plans: Plan[]
  accentColor?: string
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", CAD: "C$",
  AUD: "A$", JPY: "¥", CHF: "CHF", BRL: "R$",
}

const FONTS: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: "Georgia, 'Times New Roman', serif",
  mono: 'ui-monospace, "Cascadia Code", monospace',
}

const RADIUS: Record<string, string> = {
  rounded: "8px",
  pill: "999px",
  square: "4px",
}

export default function PaywallPreview({ config, plans, accentColor = "#6366F1" }: Props) {
  const [yearly, setYearly] = useState(false)
  const [closed, setClosed] = useState(false)

  const discount = config.yearly_discount_percent ?? 20
  const currency = config.currency ?? "USD"
  const sym = CURRENCY_SYMBOLS[currency] ?? "$"
  const font = FONTS[config.font_family ?? "system"]
  const btnRadius = RADIUS[config.button_shape ?? "rounded"]
  const template = config.template ?? "classic-modal"

  function getPrice(plan: Plan) {
    if (yearly && plan.price_yearly > 0) {
      return currency === "JPY"
        ? Math.round(plan.price_yearly / 12)
        : Math.round(plan.price_yearly / 12 / 100)
    }
    return currency === "JPY"
      ? Math.round(plan.price_monthly)
      : Math.round(plan.price_monthly / 100)
  }

  if (closed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center p-8">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-2xl">🔒</div>
        <p className="text-sm text-white/60">App content here</p>
        <button onClick={() => setClosed(false)} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white/60 transition-colors">
          Show paywall
        </button>
      </div>
    )
  }

  // ── Shared inner content builders ──────────────────────────────────────────

  function SocialProof() {
    if (!config.social_proof) return null
    const type = config.social_proof_type ?? "text"
    if (type === "none") return null
    if (type === "stars") return (
      <div className="flex items-center gap-1.5 mb-3">
        <div className="flex gap-0.5">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />)}</div>
        <span className="text-[10px] text-white/50">{config.social_proof}</span>
      </div>
    )
    if (type === "user_count") return (
      <div className="flex items-center gap-2 mb-3">
        <div className="flex -space-x-1.5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="w-5 h-5 rounded-full border border-[#0F0F12]" style={{ background: `hsl(${i * 60}, 60%, 50%)` }} />)}</div>
        <span className="text-[10px] text-white/40">{config.social_proof}</span>
      </div>
    )
    return <p className="text-[10px] text-white/40 mb-3">✦ {config.social_proof}</p>
  }

  function TrustBadges() {
    const badges = config.trust_badges ?? []
    if (!badges.length) return null
    return (
      <div className="flex flex-wrap gap-1.5 mt-3">
        {badges.map((b, i) => (
          <span key={i} className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full border border-white/10 text-white/40">
            <Shield className="w-2.5 h-2.5" /> {b}
          </span>
        ))}
      </div>
    )
  }

  function Guarantee() {
    if (!config.guarantee_text) return null
    return (
      <div className="flex items-center justify-center gap-1.5 mt-2">
        <Shield className="w-3 h-3 text-emerald-400" />
        <span className="text-[10px] text-emerald-400">{config.guarantee_text}</span>
      </div>
    )
  }

  function Urgency() {
    if (!config.urgency_text) return null
    return (
      <div className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg mb-3" style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}30` }}>
        <Zap className="w-3 h-3" style={{ color: accentColor }} />
        <span className="text-[10px] font-medium" style={{ color: accentColor }}>{config.urgency_text}</span>
      </div>
    )
  }

  function YearlyToggle() {
    if (config.show_yearly_toggle === false) return null
    if (!plans.some(p => p.price_yearly > 0)) return null
    return (
      <div className="flex items-center justify-center gap-2 mb-3">
        <span className={`text-[10px] ${!yearly ? "text-white" : "text-white/40"}`}>Monthly</span>
        <button onClick={() => setYearly(!yearly)} className="relative w-8 h-4 rounded-full transition-colors flex-shrink-0" style={{ background: yearly ? accentColor : "rgba(255,255,255,0.12)" }}>
          <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${yearly ? "translate-x-4" : ""}`} />
        </button>
        <span className={`text-[10px] ${yearly ? "text-white" : "text-white/40"}`}>Yearly</span>
        {yearly && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${accentColor}20`, color: accentColor }}>Save {discount}%</span>}
      </div>
    )
  }

  function PlanCard({ plan, compact = false }: { plan: Plan, compact?: boolean }) {
    const price = getPrice(plan)
    return (
      <div className={`rounded-xl ${compact ? "p-2.5" : "p-3"} border transition-all cursor-pointer`}
        style={plan.is_popular ? { borderColor: `${accentColor}60`, background: `${accentColor}10` } : { borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
      >
        {plan.is_popular && <p className="text-[8px] font-bold mb-1" style={{ color: accentColor }}>★ POPULAR</p>}
        <p className="text-[11px] font-semibold text-white mb-0.5">{plan.name}</p>
        <div className="mb-2">
          <span className="text-lg font-bold text-white font-mono">{sym}{price}</span>
          <span className="text-[8px] text-white/40">/mo</span>
        </div>
        {!compact && (
          <ul className="space-y-0.5 mb-2">
            {(plan.features ?? []).slice(0, 4).map((f, i) => (
              <li key={i} className="flex items-start gap-1 text-[9px] text-white/50">
                <Check className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" style={{ color: accentColor }} />
                <span className="line-clamp-1">{f}</span>
              </li>
            ))}
          </ul>
        )}
        <button className="w-full py-1.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: plan.is_popular ? accentColor : "rgba(255,255,255,0.1)", borderRadius: btnRadius }}
        >
          {config.cta_copy ?? "Get started"}
        </button>
      </div>
    )
  }

  // ── Template: Classic Modal ────────────────────────────────────────────────
  if (template === "classic-modal") return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ fontFamily: font }}>
      <div className="absolute inset-0 rounded-xl" style={{ background: `rgba(0,0,0,${(config.overlay_opacity ?? 65) / 100})`, backdropFilter: "blur(6px)" }} />
      <div className="relative bg-[#0F0F12] border border-white/10 rounded-2xl w-full max-w-sm mx-4 shadow-2xl overflow-auto max-h-[90%]">
        {config.closeable !== false && (
          <button onClick={() => setClosed(true)} className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center z-10">
            <X className="w-3 h-3 text-white/40" />
          </button>
        )}
        <div className="p-5">
          <Urgency />
          <h2 className="font-bold text-base text-white leading-tight mb-1 pr-6">{config.headline ?? "Unlock the full power of your app"}</h2>
          {config.subheadline && <p className="text-[11px] text-white/50 mb-2">{config.subheadline}</p>}
          {config.body_copy && <p className="text-[10px] text-white/40 mb-3 whitespace-pre-line">{config.body_copy}</p>}
          <SocialProof />
          <YearlyToggle />
          <div className={`grid gap-2 ${plans.length > 2 ? "grid-cols-3" : plans.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
            {plans.slice(0, 3).map(p => <PlanCard key={p.id} plan={p} />)}
          </div>
          <TrustBadges />
          <Guarantee />
          <p className="text-[9px] text-white/25 text-center mt-3">{config.footer_text ?? "Cancel anytime · No hidden fees"}</p>
        </div>
      </div>
    </div>
  )

  // ── Template: Slide-in (corner popup) ─────────────────────────────────────
  if (template === "slide-in") return (
    <div className="absolute inset-0" style={{ fontFamily: font }}>
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 opacity-40" />
      <div className="absolute bottom-4 right-4 w-[260px] bg-[#0F0F12] border border-white/12 rounded-xl shadow-2xl overflow-hidden">
        {config.closeable !== false && (
          <button onClick={() => setClosed(true)} className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/5 flex items-center justify-center z-10">
            <X className="w-2.5 h-2.5 text-white/40" />
          </button>
        )}
        <div className="p-3.5">
          {config.urgency_text && <div className="text-[9px] font-medium mb-2 px-2 py-1 rounded-md" style={{ background: `${accentColor}15`, color: accentColor }}>⚡ {config.urgency_text}</div>}
          <h2 className="font-bold text-[13px] text-white leading-tight mb-1 pr-5">{config.headline ?? "Unlock full access"}</h2>
          {config.subheadline && <p className="text-[9px] text-white/50 mb-2">{config.subheadline}</p>}
          <YearlyToggle />
          {plans.slice(0, 1).map(p => <PlanCard key={p.id} plan={p} compact />)}
          <Guarantee />
          <p className="text-[8px] text-white/20 text-center mt-2">{config.footer_text ?? "Cancel anytime"}</p>
        </div>
      </div>
    </div>
  )

  // ── Template: Fullscreen (2-column) ────────────────────────────────────────
  if (template === "fullscreen") return (
    <div className="absolute inset-0 flex" style={{ fontFamily: font, background: "#0A0A0F" }}>
      {/* Left: copy */}
      <div className="flex-1 flex flex-col justify-center p-6 border-r border-white/6">
        {config.urgency_text && <div className="inline-flex items-center gap-1 text-[9px] font-medium mb-3 px-2 py-1 rounded-full w-fit" style={{ background: `${accentColor}15`, color: accentColor }}><Zap className="w-2.5 h-2.5" />{config.urgency_text}</div>}
        <h2 className="font-bold text-lg text-white leading-tight mb-2">{config.headline ?? "Unlock the full power of your app"}</h2>
        {config.subheadline && <p className="text-xs text-white/50 mb-3">{config.subheadline}</p>}
        {config.body_copy && <p className="text-[10px] text-white/40 whitespace-pre-line mb-3">{config.body_copy}</p>}
        <SocialProof />
        <TrustBadges />
        <Guarantee />
      </div>
      {/* Right: pricing */}
      <div className="w-[55%] flex flex-col justify-center p-5 overflow-y-auto">
        <YearlyToggle />
        <div className="space-y-2">
          {plans.slice(0, 3).map(p => <PlanCard key={p.id} plan={p} />)}
        </div>
        <p className="text-[8px] text-white/20 text-center mt-3">{config.footer_text ?? "Cancel anytime · No hidden fees"}</p>
      </div>
    </div>
  )

  // ── Template: Bottom Sheet ─────────────────────────────────────────────────
  if (template === "bottom-sheet") return (
    <div className="absolute inset-0 flex flex-col" style={{ fontFamily: font }}>
      <div className="flex-1 rounded-t-xl" style={{ background: `rgba(0,0,0,${(config.overlay_opacity ?? 65) / 100})` }} />
      <div className="bg-[#0F0F12] border-t border-white/10 rounded-t-2xl shadow-2xl">
        <div className="w-8 h-1 bg-white/20 rounded-full mx-auto mt-2.5 mb-3" />
        {config.closeable !== false && (
          <button onClick={() => setClosed(true)} className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/5 flex items-center justify-center">
            <X className="w-3 h-3 text-white/40" />
          </button>
        )}
        <div className="px-4 pb-4">
          <Urgency />
          <h2 className="font-bold text-base text-white mb-1">{config.headline ?? "Unlock full access"}</h2>
          {config.subheadline && <p className="text-[10px] text-white/50 mb-2">{config.subheadline}</p>}
          <SocialProof />
          <YearlyToggle />
          <div className={`grid gap-2 ${plans.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {plans.slice(0, 2).map(p => <PlanCard key={p.id} plan={p} compact />)}
          </div>
          <Guarantee />
          <p className="text-[8px] text-white/20 text-center mt-2">{config.footer_text ?? "Cancel anytime · No hidden fees"}</p>
        </div>
      </div>
    </div>
  )

  // ── Template: Minimal ─────────────────────────────────────────────────────
  if (template === "minimal") {
    const plan = plans.find(p => p.is_popular) ?? plans[0]
    const price = plan ? getPrice(plan) : 0
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={{ fontFamily: font }}>
        <div className="absolute inset-0 rounded-xl" style={{ background: `rgba(0,0,0,${(config.overlay_opacity ?? 65) / 100})`, backdropFilter: "blur(8px)" }} />
        <div className="relative bg-[#0F0F12]/90 border border-white/8 rounded-2xl p-6 w-full max-w-[260px] mx-4 text-center">
          {config.closeable !== false && (
            <button onClick={() => setClosed(true)} className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/5 flex items-center justify-center">
              <X className="w-3 h-3 text-white/40" />
            </button>
          )}
          {config.urgency_text && <p className="text-[9px] font-medium mb-2" style={{ color: accentColor }}>⚡ {config.urgency_text}</p>}
          <h2 className="font-bold text-base text-white mb-1 pr-4">{config.headline ?? "Go Pro"}</h2>
          {config.subheadline && <p className="text-[10px] text-white/50 mb-3">{config.subheadline}</p>}
          {plan && (
            <div className="mb-4">
              <span className="text-3xl font-bold text-white font-mono">{sym}{price}</span>
              <span className="text-[10px] text-white/40">/mo</span>
            </div>
          )}
          <YearlyToggle />
          <button className="w-full py-2.5 text-sm font-bold text-white mb-3 transition-opacity hover:opacity-90"
            style={{ background: accentColor, borderRadius: btnRadius }}
          >
            {config.cta_copy ?? "Get started"}
          </button>
          <Guarantee />
          <p className="text-[8px] text-white/20 mt-2">{config.footer_text ?? "Cancel anytime"}</p>
        </div>
      </div>
    )
  }

  // ── Template: Side Panel ──────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 flex" style={{ fontFamily: font }}>
      <div className="flex-1" style={{ background: `rgba(0,0,0,${(config.overlay_opacity ?? 65) / 100})` }} />
      <div className="w-[300px] bg-[#0F0F12] border-l border-white/10 flex flex-col overflow-y-auto shadow-2xl">
        {config.closeable !== false && (
          <button onClick={() => setClosed(true)} className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/5 flex items-center justify-center z-10">
            <X className="w-3 h-3 text-white/40" />
          </button>
        )}
        <div className="p-5 flex flex-col gap-3 flex-1">
          <div>
            <Urgency />
            <h2 className="font-bold text-base text-white leading-tight mb-1 pr-5">{config.headline ?? "Unlock full access"}</h2>
            {config.subheadline && <p className="text-[10px] text-white/50">{config.subheadline}</p>}
            {config.body_copy && <p className="text-[10px] text-white/40 mt-2 whitespace-pre-line">{config.body_copy}</p>}
          </div>
          <SocialProof />
          <YearlyToggle />
          <div className="space-y-2">
            {plans.slice(0, 3).map(p => <PlanCard key={p.id} plan={p} />)}
          </div>
          <div>
            <TrustBadges />
            <Guarantee />
          </div>
          <p className="text-[8px] text-white/20 text-center mt-auto">{config.footer_text ?? "Cancel anytime · No hidden fees"}</p>
        </div>
      </div>
    </div>
  )
}

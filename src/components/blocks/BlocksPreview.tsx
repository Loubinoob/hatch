"use client"

import { useState } from "react"
import { Check, Shield, Star, ChevronDown, ChevronUp, X } from "lucide-react"
import type { Block, BlockTheme, DisplayMode } from "@/lib/blocks/types"

type Plan = {
  id: string
  name: string
  price_monthly: number
  price_yearly: number
  features: string[]
  is_popular: boolean
}

interface Props {
  blocks:      Block[]
  plans:       Plan[]
  theme:       Partial<BlockTheme>
  displayMode: DisplayMode
  onClose?:    () => void
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$", JPY: "¥", CHF: "CHF", BRL: "R$",
}

const FONTS: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif:  "Georgia, 'Times New Roman', serif",
  mono:   'ui-monospace, "Cascadia Code", monospace',
}

const RADIUS: Record<string, string> = {
  rounded: "8px",
  pill:    "999px",
  square:  "4px",
}

export default function BlocksPreview({ blocks, plans: rawPlans, theme, displayMode, onClose }: Props) {
  const plans = rawPlans.slice().sort((a, b) => (a.price_monthly ?? 0) - (b.price_monthly ?? 0))
  const [yearly, setYearly] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const accent    = theme.accentColor ?? "#6366F1"
  const font      = FONTS[theme.fontFamily ?? "system"]
  const btnRadius = RADIUS[theme.buttonShape ?? "rounded"]
  const sym       = CURRENCY_SYMBOLS["USD"]

  function getPrice(plan: Plan) {
    if (yearly && plan.price_yearly > 0) return Math.round(plan.price_yearly / 12 / 100)
    return Math.round(plan.price_monthly / 100)
  }

  // ── Individual block renderers ───────────────────────────────────────────────

  function RenderBlock({ block }: { block: Block }) {
    const p = block.props as Record<string, unknown>

    switch (block.type) {

      case "hero": {
        const align = (p.alignment as string) ?? "center"
        return (
          <div className={`px-5 pt-5 pb-3 ${align === "center" ? "text-center" : "text-left"}`}
            style={p.bgImage ? { backgroundImage: `url(${p.bgImage})`, backgroundSize: "cover" } : {}}>
            {p.eyebrow != null && (
              <span className="inline-block text-[9px] font-semibold px-2 py-0.5 rounded-full mb-2"
                style={{ background: `${accent}20`, color: accent }}>
                {p.eyebrow as string}
              </span>
            )}
            <h2 className="font-bold text-base text-white leading-tight mb-1.5">
              {(p.headline as string) ?? "Unlock full access"}
            </h2>
            {p.subheadline != null && (
              <p className="text-[11px] text-white/60 leading-relaxed">
                {p.subheadline as string}
              </p>
            )}
          </div>
        )
      }

      case "plans": {
        const hasFeatPlans = plans.some(pl => pl.price_yearly > 0)
        return (
          <div className="px-4 pb-3">
            {(p.yearlyToggle as boolean) !== false && hasFeatPlans && (
              <div className="flex items-center justify-center gap-2 mb-3">
                <span className={`text-[10px] ${!yearly ? "text-white" : "text-white/40"}`}>Monthly</span>
                <button onClick={() => setYearly(!yearly)}
                  className="relative w-8 h-4 rounded-full flex-shrink-0 transition-colors"
                  style={{ background: yearly ? accent : "rgba(255,255,255,0.12)" }}>
                  <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${yearly ? "translate-x-4" : ""}`} />
                </button>
                <span className={`text-[10px] ${yearly ? "text-white" : "text-white/40"}`}>Yearly</span>
              </div>
            )}
            <div className={`grid gap-2 ${plans.length > 2 ? "grid-cols-3" : plans.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
              {plans.slice(0, 3).map(plan => (
                <div key={plan.id} className="rounded-xl p-3 border"
                  style={plan.is_popular
                    ? { borderColor: `${accent}60`, background: `${accent}10` }
                    : { borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                  {plan.is_popular && (
                    <p className="text-[8px] font-bold mb-0.5" style={{ color: accent }}>★ POPULAR</p>
                  )}
                  <p className="text-[11px] font-semibold text-white mb-0.5">{plan.name}</p>
                  <div className="mb-2">
                    <span className="text-lg font-bold text-white font-mono">{sym}{getPrice(plan)}</span>
                    <span className="text-[8px] text-white/40">/mo</span>
                  </div>
                  <ul className="space-y-0.5 mb-2">
                    {(plan.features ?? []).slice(0, 3).map((f, i) => (
                      <li key={i} className="flex items-start gap-1 text-[9px] text-white/50">
                        <Check className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" style={{ color: accent }} />
                        <span className="line-clamp-1">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button className="w-full py-1.5 text-[10px] font-semibold text-white"
                    style={{ background: plan.is_popular ? accent : "rgba(255,255,255,0.1)", borderRadius: btnRadius }}>
                    {(p.ctaCopy as string) || "Get started"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      }

      case "features": {
        const items = (p.items as Array<{ icon: string; text: string }>) ?? []
        return (
          <div className="px-5 pb-3">
            {p.title != null && <p className="text-[11px] font-semibold text-white mb-2">{p.title as string}</p>}
            <ul className="space-y-1.5">
              {items.map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-[10px] text-white/70">
                  <span className="w-4 text-center flex-shrink-0">{item.icon}</span>
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
        )
      }

      case "testimonials": {
        const items = (p.items as Array<{ quote: string; author: string; role: string }>) ?? []
        return (
          <div className="px-5 pb-3">
            {p.title != null && <p className="text-[11px] font-semibold text-white mb-2">{p.title as string}</p>}
            <div className={`grid gap-2 ${items.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {items.slice(0, 4).map((item, i) => (
                <div key={i} className="rounded-lg p-2.5 border border-white/6 bg-white/2">
                  <div className="flex gap-0.5 mb-1">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <Star key={j} className="w-2 h-2 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-[9px] text-white/60 leading-relaxed mb-1.5 line-clamp-2">
                    &ldquo;{item.quote}&rdquo;
                  </p>
                  <p className="text-[9px] font-semibold text-white/80">{item.author}</p>
                  {item.role && <p className="text-[8px] text-white/40">{item.role}</p>}
                </div>
              ))}
            </div>
          </div>
        )
      }

      case "logos": {
        const items = (p.items as Array<{ name: string; logo_url?: string }>) ?? []
        return (
          <div className="px-5 pb-3 text-center">
            {p.title != null && <p className="text-[9px] text-white/30 uppercase tracking-widest mb-2">{p.title as string}</p>}
            <div className="flex flex-wrap justify-center gap-3">
              {items.map((item, i) => (
                item.logo_url
                  ? <img key={i} src={item.logo_url} alt={item.name} className="h-5 opacity-40 object-contain" />
                  : <span key={i} className="text-[10px] text-white/30 font-semibold px-2 py-1 border border-white/6 rounded">{item.name}</span>
              ))}
            </div>
          </div>
        )
      }

      case "comparison": {
        const rows = (p.rows as Array<{ feature: string; values: string[] }>) ?? []
        return (
          <div className="px-4 pb-3">
            {p.title != null && <p className="text-[11px] font-semibold text-white mb-2">{p.title as string}</p>}
            <div className="border border-white/8 rounded-lg overflow-hidden">
              <div className="grid grid-cols-3 bg-white/5 px-2 py-1.5">
                <span className="text-[9px] text-white/40">Feature</span>
                {plans.slice(0, 2).map(pl => (
                  <span key={pl.id} className="text-[9px] font-semibold text-white text-center">{pl.name}</span>
                ))}
              </div>
              {rows.slice(0, 6).map((row, i) => (
                <div key={i} className={`grid grid-cols-3 px-2 py-1.5 ${i % 2 === 0 ? "" : "bg-white/2"}`}>
                  <span className="text-[9px] text-white/60">{row.feature}</span>
                  {(row.values ?? []).slice(0, 2).map((val, j) => (
                    <span key={j} className={`text-[9px] text-center ${val === "✓" ? "text-emerald-400" : val === "✗" ? "text-white/25" : "text-white/70"}`}>
                      {val}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )
      }

      case "faq": {
        const items = (p.items as Array<{ question: string; answer: string }>) ?? []
        return (
          <div className="px-4 pb-3">
            {p.title != null && <p className="text-[11px] font-semibold text-white mb-2">{p.title as string}</p>}
            <div className="space-y-1">
              {items.map((item, i) => (
                <div key={i} className="border border-white/6 rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                    <span className="text-[10px] font-medium text-white">{item.question}</span>
                    {openFaq === i
                      ? <ChevronUp className="w-3 h-3 text-white/40 flex-shrink-0" />
                      : <ChevronDown className="w-3 h-3 text-white/40 flex-shrink-0" />
                    }
                  </button>
                  {openFaq === i && (
                    <div className="px-3 pb-2.5 text-[9px] text-white/50 leading-relaxed">
                      {item.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      }

      case "urgency": {
        return (
          <div className="px-4 pb-2">
            <div className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg"
              style={{ background: `${accent}15`, border: `1px solid ${accent}30` }}>
              <span className="text-[10px] font-semibold" style={{ color: accent }}>
                ⏰ {(p.text as string) ?? "Limited offer"}
              </span>
            </div>
            {p.subtext != null && (
              <p className="text-[9px] text-white/40 text-center mt-1">{p.subtext as string}</p>
            )}
          </div>
        )
      }

      case "guarantee": {
        return (
          <div className="px-4 pb-3 flex items-center justify-center gap-2">
            <Shield className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <p className="text-[9px] text-emerald-400 text-center">
              {(p.text as string) ?? "30-day money-back guarantee"}
            </p>
          </div>
        )
      }

      case "video": {
        return (
          <div className="px-4 pb-3">
            {p.title != null && <p className="text-[10px] text-white/60 mb-1.5 text-center">{p.title as string}</p>}
            <div className="rounded-lg overflow-hidden aspect-video bg-white/5 flex items-center justify-center border border-white/8">
              {p.url
                ? <iframe
                    src={String(p.url).replace("watch?v=", "embed/")}
                    className="w-full h-full"
                    allowFullScreen
                  />
                : <span className="text-[10px] text-white/30">▶ Video preview</span>
              }
            </div>
          </div>
        )
      }

      case "stats": {
        const items = (p.items as Array<{ value: string; label: string }>) ?? []
        return (
          <div className="px-5 pb-3">
            <div className={`grid gap-3 ${items.length >= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
              {items.map((item, i) => (
                <div key={i} className="text-center">
                  <p className="text-xl font-bold text-white" style={{ color: accent }}>{item.value}</p>
                  <p className="text-[8px] text-white/40 mt-0.5">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        )
      }

      case "footer": {
        return (
          <div className="px-4 pb-4 pt-1 text-center">
            <p className="text-[8px] text-white/25">
              {(p.text as string) ?? "Cancel anytime · No hidden fees"}
            </p>
            {!!p.showPoweredBy && (
              <p className="text-[7px] text-white/15 mt-1">⚡ Powered by Hatch</p>
            )}
          </div>
        )
      }

      default:
        return <div className="px-4 py-2 text-[9px] text-white/30 italic">Unknown block: {block.type}</div>
    }
  }

  // ── Container wrappers ───────────────────────────────────────────────────────

  const content = (
    <div style={{ fontFamily: font }}>
      {blocks.map(block => <RenderBlock key={block.id} block={block} />)}
    </div>
  )

  if (displayMode === "fullscreen") {
    return (
      <div className="absolute inset-0 bg-[#0A0A0F] overflow-y-auto">
        {onClose && (
          <button onClick={onClose}
            className="sticky top-3 right-3 float-right z-10 w-7 h-7 rounded-full bg-white/8 hover:bg-white/12 flex items-center justify-center mr-3 mt-3">
            <X className="w-3 h-3 text-white/50" />
          </button>
        )}
        <div className="max-w-lg mx-auto py-6 px-4">
          {content}
        </div>
      </div>
    )
  }

  // Modal mode
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ fontFamily: font }}>
      <div className="absolute inset-0 rounded-xl bg-black/70 backdrop-blur" />
      <div className="relative bg-[#0F0F12] border border-white/10 rounded-2xl w-full max-w-sm mx-3 shadow-2xl overflow-auto max-h-[90%]">
        {onClose && (
          <button onClick={onClose}
            className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center z-10">
            <X className="w-3 h-3 text-white/40" />
          </button>
        )}
        {content}
      </div>
    </div>
  )
}

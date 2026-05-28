"use client"

import { useState, useEffect, useRef } from "react"
import { Check, Shield, Star, ChevronDown, ChevronUp, X, Sparkles, TrendingUp, Lock, Zap, Heart, Award, Crown } from "lucide-react"
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
  blocks:        Block[]
  plans:         Plan[]
  theme:         Partial<BlockTheme>
  displayMode:   DisplayMode
  onClose?:      () => void
  device?:       "mobile" | "desktop"
  highlightId?:  string | null
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$", JPY: "¥", CHF: "CHF", BRL: "R$",
}

const FONTS: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
  serif:  '"Tiempos", "Charter", Georgia, "Times New Roman", serif',
  mono:   '"JetBrains Mono", ui-monospace, "Cascadia Code", monospace',
}

const RADIUS: Record<string, string> = {
  rounded: "12px",
  pill:    "999px",
  square:  "4px",
}

const PADDING_MAP: Record<string, string> = { s: "12px", m: "20px", l: "32px" }

// Icon lookup for features
const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  check:  Check, sparkles: Sparkles, trending: TrendingUp, lock: Lock,
  zap:    Zap, heart: Heart, award: Award, crown: Crown, star: Star, shield: Shield,
}

export default function BlocksPreview({ blocks, plans: rawPlans, theme, displayMode, onClose, device = "desktop", highlightId = null }: Props) {
  const plans = rawPlans.slice().sort((a, b) => (a.price_monthly ?? 0) - (b.price_monthly ?? 0))
  const [yearly, setYearly] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Scroll the selected block into view when selectedBlockId changes
  useEffect(() => {
    if (!highlightId) return
    const root = containerRef.current
    if (!root) return
    const el = root.querySelector(`[data-block-id="${highlightId}"]`) as HTMLElement | null
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }, [highlightId])

  const accent    = theme.accentColor ?? "#6366F1"
  const font      = FONTS[theme.fontFamily ?? "system"]
  const btnRadius = RADIUS[theme.buttonShape ?? "rounded"]
  const sym       = CURRENCY_SYMBOLS["USD"]

  function getPrice(plan: Plan) {
    if (yearly && plan.price_yearly > 0) return plan.price_yearly / 12 / 100
    return plan.price_monthly / 100
  }
  function getYearlySavings(plan: Plan) {
    if (plan.price_yearly <= 0 || plan.price_monthly <= 0) return null
    const monthlyTotal = plan.price_monthly * 12
    const savings = ((monthlyTotal - plan.price_yearly) / monthlyTotal) * 100
    return Math.round(savings)
  }

  // ── Block-level helpers ─────────────────────────────────────────────────────
  function blockWrapperStyle(props: Record<string, unknown>): React.CSSProperties {
    const padY = (props.paddingY as string) ?? "m"
    const align = (props.alignment as string) ?? "center"
    const accentOverride = (props.accentOverride as string) ?? null
    return {
      paddingTop:    PADDING_MAP[padY] ?? PADDING_MAP.m,
      paddingBottom: PADDING_MAP[padY] ?? PADDING_MAP.m,
      paddingLeft:   device === "mobile" ? "16px" : "28px",
      paddingRight:  device === "mobile" ? "16px" : "28px",
      textAlign:     align === "left" ? "left" : "center",
      // Background priority: image > gradient > solid
      ...(props.bgImageUrl ? {
        backgroundImage:    `linear-gradient(180deg, rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url(${props.bgImageUrl})`,
        backgroundSize:     "cover",
        backgroundPosition: "center",
      } : props.bgGradient ? {
        backgroundImage: props.bgGradient as string,
      } : props.bgColor ? {
        background: props.bgColor as string,
      } : {}),
      ...(accentOverride ? { ["--block-accent" as string]: accentOverride } : {}),
    }
  }

  function effectiveAccent(props: Record<string, unknown>) {
    return (props.accentOverride as string) || accent
  }

  // ── Individual block renderers ───────────────────────────────────────────────

  function RenderBlock({ block }: { block: Block }) {
    const p = block.props as Record<string, unknown>
    if (p.hidden === true) return null
    const acc = effectiveAccent(p)
    const wrap = blockWrapperStyle(p)

    switch (block.type) {

      // ─── HERO ──────────────────────────────────────────────────────────────
      case "hero": {
        const align = (p.alignment as string) ?? "center"
        return (
          <div className="hatch-block-hero" style={wrap}>
            {p.eyebrow != null && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-3 py-1 rounded-full mb-3"
                style={{ background: `${acc}22`, color: acc, letterSpacing: "0.08em" }}
              >
                {p.eyebrow as string}
              </span>
            )}
            <h2 className={`font-bold text-white leading-[1.15] mb-2 ${device === "mobile" ? "text-[22px]" : "text-[28px]"}`}
              style={{ letterSpacing: "-0.02em", textAlign: align === "left" ? "left" : "center" }}>
              {(p.headline as string) ?? "Unlock the full power"}
            </h2>
            {p.subheadline != null && (
              <p className="text-[13px] text-white/65 leading-[1.5] max-w-md mx-auto">
                {p.subheadline as string}
              </p>
            )}
          </div>
        )
      }

      // ─── PLANS ─────────────────────────────────────────────────────────────
      case "plans": {
        const hasYearly = plans.some(pl => pl.price_yearly > 0)
        const ctaCopy = (p.ctaCopy as string) || "Get started"
        const isMobile = device === "mobile" || plans.length === 1
        return (
          <div className="hatch-block-plans" style={{ ...wrap, paddingLeft: device === "mobile" ? "16px" : "20px", paddingRight: device === "mobile" ? "16px" : "20px" }}>
            {(p.yearlyToggle as boolean) !== false && hasYearly && (
              <div className="flex items-center justify-center gap-3 mb-5">
                <span className={`text-[11px] font-medium transition-colors ${!yearly ? "text-white" : "text-white/40"}`}>Monthly</span>
                <button
                  onClick={() => setYearly(!yearly)}
                  className="relative w-10 h-5 rounded-full flex-shrink-0 transition-all"
                  style={{ background: yearly ? acc : "rgba(255,255,255,0.15)" }}
                >
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${yearly ? "translate-x-5" : ""}`} />
                </button>
                <span className={`text-[11px] font-medium transition-colors ${yearly ? "text-white" : "text-white/40"}`}>
                  Yearly
                  {yearly && (
                    <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${acc}33`, color: acc }}>SAVE 20%</span>
                  )}
                </span>
              </div>
            )}
            <div className={`grid gap-3 ${isMobile ? "grid-cols-1" : plans.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
              {plans.slice(0, 3).map(plan => {
                const popular = !!plan.is_popular
                const savings = yearly && plan.price_yearly > 0 ? getYearlySavings(plan) : null
                return (
                  <div
                    key={plan.id}
                    className="relative rounded-2xl p-4 transition-all"
                    style={popular ? {
                      background: `linear-gradient(180deg, ${acc}18, ${acc}06)`,
                      border: `1.5px solid ${acc}55`,
                      boxShadow: `0 0 0 1px ${acc}22, 0 12px 32px -8px ${acc}40`,
                    } : {
                      background: "rgba(255,255,255,0.03)",
                      border: "1.5px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {popular && (
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
                        style={{ background: acc, color: "#fff", letterSpacing: "0.1em" }}>
                        ★ Most Popular
                      </div>
                    )}
                    <p className="text-[12px] font-semibold text-white/90 mt-1 mb-1">{plan.name}</p>
                    <div className="flex items-baseline gap-1 mb-3">
                      <span className="text-[26px] font-bold text-white tracking-tight"
                        style={{ fontFeatureSettings: '"tnum"' }}>
                        {sym}{getPrice(plan).toFixed(getPrice(plan) < 10 ? 2 : 0)}
                      </span>
                      <span className="text-[10px] text-white/45">/mo</span>
                      {savings != null && savings > 0 && (
                        <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: `${acc}22`, color: acc }}>
                          Save {savings}%
                        </span>
                      )}
                    </div>
                    <ul className="space-y-1.5 mb-4">
                      {(plan.features ?? []).slice(0, 4).map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11px] text-white/70 leading-[1.4]">
                          <Check className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: acc }} strokeWidth={3} />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      className="w-full py-2.5 text-[11px] font-semibold transition-all"
                      style={{
                        background: popular ? acc : "rgba(255,255,255,0.08)",
                        color: popular ? "#fff" : "rgba(255,255,255,0.92)",
                        borderRadius: btnRadius,
                        boxShadow: popular ? `0 4px 12px ${acc}55` : "none",
                      }}
                    >
                      {ctaCopy}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )
      }

      // ─── FEATURES ──────────────────────────────────────────────────────────
      case "features": {
        const items = (p.items as Array<{ icon: string; text: string }>) ?? []
        const layout = (p.layout as string) ?? "list"
        return (
          <div className="hatch-block-features" style={wrap}>
            {p.title != null && (
              <p className="text-[13px] font-semibold text-white mb-3">{p.title as string}</p>
            )}
            <ul className={layout === "grid" ? "grid grid-cols-2 gap-2" : "space-y-2"}>
              {items.map((item, i) => {
                const Icon = ICON_MAP[item.icon as string] ?? Check
                return (
                  <li key={i} className="flex items-start gap-2.5 text-[12px] text-white/80 leading-[1.5]">
                    <span
                      className="flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0 mt-0.5"
                      style={{ background: `${acc}1f`, color: acc }}
                    >
                      {typeof item.icon === "string" && item.icon.length <= 3 && !ICON_MAP[item.icon]
                        ? <span className="text-[11px]">{item.icon}</span>
                        : <Icon className="w-3 h-3" style={{ color: acc }} />
                      }
                    </span>
                    <span>{item.text}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      }

      // ─── TESTIMONIALS ──────────────────────────────────────────────────────
      case "testimonials": {
        const items = (p.items as Array<{ quote: string; author: string; role: string; avatar?: string }>) ?? []
        return (
          <div className="hatch-block-testimonials" style={wrap}>
            {p.title != null && (
              <p className="text-[12px] font-semibold text-white/90 uppercase tracking-wider mb-3" style={{ letterSpacing: "0.08em" }}>
                {p.title as string}
              </p>
            )}
            <div className={`grid gap-3 ${items.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {items.slice(0, 4).map((item, i) => (
                <div key={i} className="rounded-xl p-3 text-left"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="flex gap-0.5 mb-2">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <Star key={j} className="w-3 h-3" style={{ fill: "#F59E0B", color: "#F59E0B" }} />
                    ))}
                  </div>
                  <p className="text-[11px] text-white/75 leading-[1.5] mb-2.5">
                    &ldquo;{item.quote}&rdquo;
                  </p>
                  <div className="flex items-center gap-2">
                    {item.avatar
                      ? <img src={item.avatar} alt={item.author} className="w-6 h-6 rounded-full object-cover" />
                      : <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ background: `linear-gradient(135deg, ${acc}, ${acc}99)` }}>
                          {item.author?.charAt(0).toUpperCase()}
                        </div>
                    }
                    <div className="leading-tight">
                      <p className="text-[10px] font-semibold text-white">{item.author}</p>
                      {item.role && <p className="text-[9px] text-white/45">{item.role}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }

      // ─── LOGOS ─────────────────────────────────────────────────────────────
      case "logos": {
        const items = (p.items as Array<{ name: string; logo_url?: string }>) ?? []
        return (
          <div className="hatch-block-logos" style={wrap}>
            {p.title != null && (
              <p className="text-[9px] text-white/40 uppercase tracking-[0.2em] font-medium mb-3">
                {p.title as string}
              </p>
            )}
            <div className="flex flex-wrap justify-center items-center gap-x-5 gap-y-3">
              {items.map((item, i) => (
                item.logo_url
                  ? <img key={i} src={item.logo_url} alt={item.name} className="h-5 opacity-50 hover:opacity-80 transition-opacity object-contain grayscale" />
                  : <span key={i} className="text-[12px] text-white/45 font-bold tracking-tight uppercase" style={{ letterSpacing: "-0.01em" }}>{item.name}</span>
              ))}
            </div>
          </div>
        )
      }

      // ─── COMPARISON ────────────────────────────────────────────────────────
      case "comparison": {
        const rows = (p.rows as Array<{ feature: string; values: string[] }>) ?? []
        return (
          <div className="hatch-block-comparison" style={wrap}>
            {p.title != null && (
              <p className="text-[13px] font-semibold text-white mb-3">{p.title as string}</p>
            )}
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="grid grid-cols-3 px-3 py-2.5" style={{ background: "rgba(255,255,255,0.04)" }}>
                <span className="text-[10px] text-white/50 font-medium">Feature</span>
                {plans.slice(0, 2).map(pl => (
                  <span key={pl.id} className="text-[10px] font-semibold text-white text-center">{pl.name}</span>
                ))}
              </div>
              {rows.slice(0, 7).map((row, i) => (
                <div key={i} className="grid grid-cols-3 px-3 py-2.5 items-center"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 1 ? "rgba(255,255,255,0.015)" : undefined }}>
                  <span className="text-[10px] text-white/65 text-left">{row.feature}</span>
                  {(row.values ?? []).slice(0, 2).map((val, j) => (
                    <span key={j} className="text-[10px] text-center font-medium"
                      style={{ color: val === "✓" || val === "yes" ? "#34D399" : val === "✗" || val === "no" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.8)" }}>
                      {val === "yes" ? "✓" : val === "no" ? "✗" : val}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )
      }

      // ─── FAQ ───────────────────────────────────────────────────────────────
      case "faq": {
        const items = (p.items as Array<{ question: string; answer: string }>) ?? []
        return (
          <div className="hatch-block-faq" style={wrap}>
            {p.title != null && (
              <p className="text-[13px] font-semibold text-white mb-3">{p.title as string}</p>
            )}
            <div className="space-y-1.5">
              {items.map((item, i) => (
                <div key={i} className="rounded-xl overflow-hidden"
                  style={{ border: "1px solid rgba(255,255,255,0.07)", background: openFaq === i ? "rgba(255,255,255,0.03)" : "transparent" }}>
                  <button
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-white/3"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                    <span className="text-[11px] font-medium text-white">{item.question}</span>
                    {openFaq === i
                      ? <ChevronUp className="w-3.5 h-3.5 text-white/50 flex-shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-white/50 flex-shrink-0" />
                    }
                  </button>
                  {openFaq === i && (
                    <div className="px-3 pb-3 text-[10px] text-white/60 leading-[1.6]">
                      {item.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      }

      // ─── URGENCY ───────────────────────────────────────────────────────────
      case "urgency": {
        return (
          <div className="hatch-block-urgency" style={{ ...wrap, paddingTop: "8px", paddingBottom: "8px" }}>
            <div className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full"
              style={{
                background: `linear-gradient(90deg, ${acc}22, ${acc}11)`,
                border: `1px solid ${acc}40`,
              }}>
              <span className="text-[10px]">⏰</span>
              <span className="text-[11px] font-semibold" style={{ color: acc }}>
                {(p.text as string) ?? "Limited time offer"}
              </span>
            </div>
            {p.subtext != null && (
              <p className="text-[10px] text-white/40 text-center mt-1.5">{p.subtext as string}</p>
            )}
          </div>
        )
      }

      // ─── GUARANTEE ─────────────────────────────────────────────────────────
      case "guarantee": {
        return (
          <div className="hatch-block-guarantee" style={wrap}>
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.18)" }}>
              <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#34D399" }} />
              <p className="text-[11px] font-medium" style={{ color: "#34D399" }}>
                {(p.text as string) ?? "30-day money-back guarantee"}
              </p>
            </div>
          </div>
        )
      }

      // ─── VIDEO ─────────────────────────────────────────────────────────────
      case "video": {
        return (
          <div className="hatch-block-video" style={wrap}>
            {p.title != null && (
              <p className="text-[11px] text-white/65 mb-2 text-center">{p.title as string}</p>
            )}
            <div className="rounded-xl overflow-hidden aspect-video flex items-center justify-center relative"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {p.url
                ? <iframe
                    src={String(p.url).replace("watch?v=", "embed/")}
                    className="w-full h-full"
                    allowFullScreen
                  />
                : <>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center"
                        style={{ background: `${acc}33`, border: `2px solid ${acc}` }}>
                        <span className="text-base" style={{ color: acc }}>▶</span>
                      </div>
                    </div>
                  </>
              }
            </div>
          </div>
        )
      }

      // ─── STATS ─────────────────────────────────────────────────────────────
      case "stats": {
        const items = (p.items as Array<{ value: string; label: string }>) ?? []
        return (
          <div className="hatch-block-stats" style={wrap}>
            <div className={`grid gap-4 ${items.length >= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
              {items.map((item, i) => (
                <div key={i} className="text-center">
                  <p className="text-[26px] font-bold tracking-tight leading-none"
                    style={{ color: acc, fontFeatureSettings: '"tnum"' }}>{item.value}</p>
                  <p className="text-[10px] text-white/55 mt-1 font-medium uppercase tracking-wider" style={{ letterSpacing: "0.06em" }}>{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        )
      }

      // ─── FOOTER ────────────────────────────────────────────────────────────
      case "footer": {
        return (
          <div className="hatch-block-footer" style={{ ...wrap, paddingTop: "12px", paddingBottom: "20px" }}>
            <p className="text-[10px] text-white/35">
              {(p.text as string) ?? "Cancel anytime · No hidden fees"}
            </p>
            {!!p.showPoweredBy && (
              <p className="text-[8px] text-white/20 mt-1.5">⚡ Powered by Hatch</p>
            )}
          </div>
        )
      }

      default:
        return <div className="px-4 py-2 text-[10px] text-white/30 italic">Unknown block: {block.type}</div>
    }
  }

  // ── Container wrappers ───────────────────────────────────────────────────────

  const content = (
    <div style={{ fontFamily: font }} ref={containerRef}>
      {blocks.map(block => (
        <div
          key={block.id}
          data-block-id={block.id}
          style={{
            outline: highlightId === block.id ? `2px solid ${accent}` : "none",
            outlineOffset: highlightId === block.id ? "-2px" : "0",
            borderRadius: "8px",
            transition: "outline-color 0.15s",
          }}
        >
          <RenderBlock block={block} />
        </div>
      ))}
    </div>
  )

  if (displayMode === "fullscreen") {
    return (
      <div className="absolute inset-0 overflow-y-auto" style={{ background: "#0A0A0F" }}>
        {onClose && (
          <button onClick={onClose}
            className="sticky top-3 right-3 float-right z-10 w-7 h-7 rounded-full bg-white/8 hover:bg-white/14 flex items-center justify-center mr-3 mt-3 transition-colors">
            <X className="w-3.5 h-3.5 text-white/60" />
          </button>
        )}
        <div className={`mx-auto py-6 px-2 ${device === "mobile" ? "max-w-[400px]" : "max-w-xl"}`}>
          {content}
        </div>
      </div>
    )
  }

  // Modal mode
  return (
    <div className="absolute inset-0 flex items-center justify-center p-3" style={{ fontFamily: font }}>
      <div className="absolute inset-0 backdrop-blur" style={{ background: `rgba(0,0,0,${(theme.overlayOpacity ?? 65) / 100})` }} />
      <div
        className="relative overflow-auto"
        style={{
          background: "#0F0F12",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "20px",
          maxHeight: "90%",
          width: "100%",
          maxWidth: device === "mobile" ? "340px" : "440px",
          boxShadow: "0 24px 64px -16px rgba(0,0,0,0.5)",
        }}
      >
        {onClose && (
          <button onClick={onClose}
            className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/8 hover:bg-white/14 flex items-center justify-center z-10 transition-colors">
            <X className="w-3.5 h-3.5 text-white/60" />
          </button>
        )}
        {content}
      </div>
    </div>
  )
}

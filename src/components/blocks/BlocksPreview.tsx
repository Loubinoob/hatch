"use client"

import { useState, useEffect, useRef } from "react"
import { Check, Shield, Star, ChevronDown, ChevronUp, X, Sparkles, TrendingUp, Lock, Zap, Heart, Award, Crown, ImageIcon } from "lucide-react"
import type { Block, BlockTheme, DisplayMode } from "@/lib/blocks/types"
import { resolveTheme } from "@/lib/blocks/theme"

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
  currency?:     string
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$", JPY: "¥", CHF: "CHF", BRL: "R$",
}

const PADDING_MAP: Record<string, string> = { s: "12px", m: "20px", l: "32px" }

const IMG_MAXW: Record<string, string> = { s: "150px", m: "240px", l: "360px", full: "100%" }

// Icon lookup for features
const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  check:  Check, sparkles: Sparkles, trending: TrendingUp, lock: Lock,
  zap:    Zap, heart: Heart, award: Award, crown: Crown, star: Star, shield: Shield,
}

export default function BlocksPreview({ blocks, plans: rawPlans, theme, displayMode, onClose, device = "desktop", highlightId = null, currency = "USD" }: Props) {
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

  // Full token set derived from the (partial) theme — drives every colour below.
  const t         = resolveTheme(theme)
  const font      = t.font
  const btnRadius = t.btnRadius
  const sym       = CURRENCY_SYMBOLS[currency] ?? "$"

  function getPrice(plan: Plan) {
    if (yearly && plan.price_yearly > 0) return plan.price_yearly / 12 / 100
    return plan.price_monthly / 100
  }
  function formatPrice(v: number) {
    return v.toFixed(v < 10 && v > 0 ? 2 : 0)
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
    return (props.accentOverride as string) || t.accent
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
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-3 py-1 rounded-full mb-3.5"
                style={{ background: `${acc}22`, color: acc, letterSpacing: "0.1em" }}
              >
                {p.eyebrow as string}
              </span>
            )}
            <h2 className={`font-bold mb-2.5 ${device === "mobile" ? "text-[24px] leading-[1.18]" : "text-[32px] leading-[1.12]"}`}
              style={{ color: t.text, letterSpacing: "-0.025em", textAlign: align === "left" ? "left" : "center" }}>
              {(p.headline as string) ?? "Unlock the full power"}
            </h2>
            {p.subheadline != null && (
              <p className={`text-[14px] leading-[1.55] max-w-md ${align === "left" ? "" : "mx-auto"}`} style={{ color: t.textMuted }}>
                {p.subheadline as string}
              </p>
            )}
          </div>
        )
      }

      // ─── IMAGE / ILLUSTRATION ────────────────────────────────────────────────
      case "image": {
        const url = p.url as string | undefined
        const align = (p.alignment as string) ?? "center"
        const maxW = IMG_MAXW[(p.size as string) ?? "m"] ?? IMG_MAXW.m
        const rounded = p.rounded !== false
        const justify = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center"
        return (
          <div className="hatch-block-image" style={{ ...wrap, display: "flex", justifyContent: justify }}>
            {url ? (
              <img
                src={url}
                alt={(p.alt as string) ?? ""}
                style={{ width: maxW, maxWidth: "100%", height: "auto", objectFit: "contain", borderRadius: rounded ? "16px" : "0" }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2"
                style={{ width: maxW === "100%" ? "100%" : maxW, aspectRatio: "4 / 3", borderRadius: "16px", background: t.videoTint, border: `1px solid ${t.cardBorder}` }}>
                <ImageIcon className="w-6 h-6" style={{ color: t.textFaint }} />
                <span className="text-[10px] uppercase tracking-wider" style={{ color: t.textFaint }}>Image</span>
              </div>
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
                <span className="text-[11px] font-medium transition-colors" style={{ color: !yearly ? t.text : t.textFaint }}>Monthly</span>
                <button
                  onClick={() => setYearly(!yearly)}
                  className="relative w-10 h-5 rounded-full flex-shrink-0 transition-all"
                  style={{ background: yearly ? acc : t.track }}
                >
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform shadow ${yearly ? "translate-x-5" : ""}`} style={{ background: "#fff" }} />
                </button>
                <span className="text-[11px] font-medium transition-colors" style={{ color: yearly ? t.text : t.textFaint }}>
                  Yearly
                  {yearly && (
                    <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${acc}33`, color: acc }}>SAVE 20%</span>
                  )}
                </span>
              </div>
            )}
            <div className={`grid gap-3.5 items-stretch ${isMobile ? "grid-cols-1" : plans.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
              {plans.slice(0, 3).map(plan => {
                const popular = !!plan.is_popular
                const savings = yearly && plan.price_yearly > 0 ? getYearlySavings(plan) : null
                const price = getPrice(plan)
                const isFree = (plan.price_monthly ?? 0) <= 0 && (plan.price_yearly ?? 0) <= 0
                return (
                  <div
                    key={plan.id}
                    className="relative flex flex-col rounded-2xl p-5 transition-all text-left"
                    style={popular ? {
                      background: `linear-gradient(180deg, ${acc}22, ${acc}08)`,
                      border: `1.5px solid ${acc}66`,
                      boxShadow: `0 0 0 1px ${acc}1f, 0 18px 44px -14px ${acc}66`,
                    } : {
                      background: t.card,
                      border: `1.5px solid ${t.cardBorder}`,
                    }}
                  >
                    {popular && (
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[9px] font-bold uppercase whitespace-nowrap"
                        style={{ background: acc, color: t.onAccent, letterSpacing: "0.08em", boxShadow: `0 4px 14px ${acc}77` }}>
                        ★ Most Popular
                      </div>
                    )}
                    <p className="text-[12px] font-semibold mb-2" style={{ color: t.text, marginTop: popular ? "6px" : 0 }}>{plan.name}</p>
                    <div className="flex items-baseline gap-1">
                      {isFree ? (
                        <span className="text-[30px] font-bold tracking-tight leading-none" style={{ color: t.text }}>Free</span>
                      ) : (
                        <>
                          <span className="text-[30px] font-bold tracking-tight leading-none" style={{ color: t.text, fontFeatureSettings: '"tnum"' }}>
                            {sym}{formatPrice(price)}
                          </span>
                          <span className="text-[11px] font-medium" style={{ color: t.textFaint }}>/mo</span>
                        </>
                      )}
                    </div>
                    {/* Reserved line for billing context — keeps card heights aligned */}
                    <div className="h-5 mt-1 mb-3 flex items-center gap-1.5">
                      {savings != null && savings > 0 ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${acc}22`, color: acc }}>
                          Save {savings}%
                        </span>
                      ) : yearly && plan.price_yearly > 0 ? (
                        <span className="text-[9.5px]" style={{ color: t.textFaint }}>billed {sym}{Math.round(plan.price_yearly / 100)}/yr</span>
                      ) : null}
                    </div>
                    <ul className="space-y-2 mb-5 flex-1">
                      {(plan.features ?? []).slice(0, 5).map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11px] leading-[1.45]" style={{ color: t.textMuted }}>
                          <span className="flex items-center justify-center w-[15px] h-[15px] rounded-full flex-shrink-0 mt-px" style={{ background: `${acc}22` }}>
                            <Check className="w-2.5 h-2.5" style={{ color: acc }} strokeWidth={3} />
                          </span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      className="w-full py-2.5 text-[11px] font-semibold transition-all"
                      style={{
                        background: popular ? acc : t.card,
                        color: popular ? t.onAccent : t.text,
                        borderRadius: btnRadius,
                        border: popular ? "none" : `1px solid ${t.cardBorder}`,
                        boxShadow: popular ? `0 6px 18px ${acc}66` : "none",
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
              <p className="text-[13px] font-semibold mb-3" style={{ color: t.text }}>{p.title as string}</p>
            )}
            <ul className={layout === "grid" ? "grid grid-cols-2 gap-2" : "space-y-2"}>
              {items.map((item, i) => {
                const Icon = ICON_MAP[item.icon as string] ?? Check
                return (
                  <li key={i} className="flex items-start gap-2.5 text-[12px] leading-[1.5]" style={{ color: t.textMuted }}>
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
              <p className="text-[12px] font-semibold uppercase tracking-wider mb-3" style={{ color: t.text, letterSpacing: "0.08em" }}>
                {p.title as string}
              </p>
            )}
            <div className={`grid gap-3 ${items.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {items.slice(0, 4).map((item, i) => (
                <div key={i} className="rounded-xl p-3 text-left"
                  style={{ background: t.card, border: `1px solid ${t.cardBorder}` }}>
                  <div className="flex gap-0.5 mb-2">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <Star key={j} className="w-3 h-3" style={{ fill: "#F59E0B", color: "#F59E0B" }} />
                    ))}
                  </div>
                  <p className="text-[11px] leading-[1.5] mb-2.5" style={{ color: t.textMuted }}>
                    &ldquo;{item.quote}&rdquo;
                  </p>
                  <div className="flex items-center gap-2">
                    {item.avatar
                      ? <img src={item.avatar} alt={item.author} className="w-6 h-6 rounded-full object-cover" />
                      : <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold"
                          style={{ background: `linear-gradient(135deg, ${acc}, ${acc}99)`, color: t.onAccent }}>
                          {item.author?.charAt(0).toUpperCase()}
                        </div>
                    }
                    <div className="leading-tight">
                      <p className="text-[10px] font-semibold" style={{ color: t.text }}>{item.author}</p>
                      {item.role && <p className="text-[9px]" style={{ color: t.textFaint }}>{item.role}</p>}
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
              <p className="text-[9px] uppercase tracking-[0.2em] font-medium mb-3" style={{ color: t.textFaint }}>
                {p.title as string}
              </p>
            )}
            <div className="flex flex-wrap justify-center items-center gap-x-5 gap-y-3">
              {items.map((item, i) => (
                item.logo_url
                  ? <img key={i} src={item.logo_url} alt={item.name} className="h-5 opacity-60 hover:opacity-100 transition-opacity object-contain grayscale" />
                  : <span key={i} className="text-[12px] font-bold tracking-tight uppercase" style={{ color: t.textFaint, letterSpacing: "-0.01em" }}>{item.name}</span>
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
              <p className="text-[13px] font-semibold mb-3" style={{ color: t.text }}>{p.title as string}</p>
            )}
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${t.cardBorder}` }}>
              <div className="grid grid-cols-3 px-3 py-2.5" style={{ background: t.card }}>
                <span className="text-[10px] font-medium" style={{ color: t.textFaint }}>Feature</span>
                {plans.slice(0, 2).map(pl => (
                  <span key={pl.id} className="text-[10px] font-semibold text-center" style={{ color: t.text }}>{pl.name}</span>
                ))}
              </div>
              {rows.slice(0, 7).map((row, i) => (
                <div key={i} className="grid grid-cols-3 px-3 py-2.5 items-center"
                  style={{ borderTop: `1px solid ${t.border}`, background: i % 2 === 1 ? t.hairline : undefined }}>
                  <span className="text-[10px] text-left" style={{ color: t.textMuted }}>{row.feature}</span>
                  {(row.values ?? []).slice(0, 2).map((val, j) => (
                    <span key={j} className="text-[10px] text-center font-medium"
                      style={{ color: val === "✓" || val === "yes" ? "#34D399" : val === "✗" || val === "no" ? t.textFaint : t.textMuted }}>
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
              <p className="text-[13px] font-semibold mb-3" style={{ color: t.text }}>{p.title as string}</p>
            )}
            <div className="space-y-1.5">
              {items.map((item, i) => (
                <div key={i} className="rounded-xl overflow-hidden"
                  style={{ border: `1px solid ${t.cardBorder}`, background: openFaq === i ? t.card : "transparent" }}>
                  <button
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                    <span className="text-[11px] font-medium" style={{ color: t.text }}>{item.question}</span>
                    {openFaq === i
                      ? <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" style={{ color: t.textFaint }} />
                      : <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: t.textFaint }} />
                    }
                  </button>
                  {openFaq === i && (
                    <div className="px-3 pb-3 text-[10px] leading-[1.6]" style={{ color: t.textMuted }}>
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
              <p className="text-[10px] text-center mt-1.5" style={{ color: t.textFaint }}>{p.subtext as string}</p>
            )}
          </div>
        )
      }

      // ─── GUARANTEE ─────────────────────────────────────────────────────────
      case "guarantee": {
        return (
          <div className="hatch-block-guarantee" style={wrap}>
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.22)" }}>
              <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#10B981" }} />
              <p className="text-[11px] font-medium" style={{ color: "#10B981" }}>
                {(p.text as string) ?? "30-day money-back guarantee"}
              </p>
            </div>
          </div>
        )
      }

      // ─── VIDEO ─────────────────────────────────────────────────────────────
      case "video": {
        const hasUrl = !!p.url
        return (
          <div className="hatch-block-video" style={wrap}>
            {p.title != null && (
              <p className="text-[12px] font-medium mb-2.5 text-center" style={{ color: t.textMuted }}>{p.title as string}</p>
            )}
            <div className="rounded-2xl overflow-hidden aspect-video relative"
              style={{ border: `1px solid ${t.cardBorder}`, background: hasUrl ? "#000" : t.videoTint }}>
              {hasUrl
                ? <iframe
                    src={String(p.url).replace("watch?v=", "embed/")}
                    className="absolute inset-0 w-full h-full"
                    allowFullScreen
                  />
                : <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center"
                      style={{ background: `${acc}22`, border: `1.5px solid ${acc}`, boxShadow: `0 8px 24px -6px ${acc}66` }}>
                      <span className="text-lg ml-0.5" style={{ color: acc }}>▶</span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: t.textFaint }}>Video preview</span>
                  </div>
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
                  <p className="text-[10px] mt-1 font-medium uppercase tracking-wider" style={{ color: t.textMuted, letterSpacing: "0.06em" }}>{item.label}</p>
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
            <p className="text-[10px]" style={{ color: t.textFaint }}>
              {(p.text as string) ?? "Cancel anytime · No hidden fees"}
            </p>
            {!!p.showPoweredBy && (
              <p className="text-[8px] mt-1.5" style={{ color: t.textFaint, opacity: 0.6 }}>⚡ Powered by Hatch</p>
            )}
          </div>
        )
      }

      default:
        return <div className="px-4 py-2 text-[10px] italic" style={{ color: t.textFaint }}>Unknown block: {block.type}</div>
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
            outline: highlightId === block.id ? `2px solid ${t.accent}` : "none",
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
      <div className="absolute inset-0 overflow-y-auto" style={{ background: t.pageGradient ?? t.pageBg }}>
        {onClose && (
          <button onClick={onClose}
            className="sticky top-3 right-3 float-right z-10 w-7 h-7 rounded-full flex items-center justify-center mr-3 mt-3 transition-colors"
            style={{ background: t.closeBg }}>
            <X className="w-3.5 h-3.5" style={{ color: t.closeIcon }} />
          </button>
        )}
        <div className={`mx-auto py-8 px-2 ${device === "mobile" ? "max-w-[400px]" : "max-w-[640px]"}`}>
          {content}
        </div>
      </div>
    )
  }

  // Modal mode
  return (
    <div className="absolute inset-0 flex items-center justify-center p-3" style={{ fontFamily: font }}>
      {/* dim host page; if a page background is set, show it behind the modal */}
      <div className="absolute inset-0" style={{ background: t.pageGradient ?? (theme.background ? t.pageBg : "transparent") }} />
      <div className="absolute inset-0 backdrop-blur" style={{ background: t.overlay }} />
      <div
        className="relative overflow-auto"
        style={{
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: "20px",
          maxHeight: "90%",
          width: "100%",
          maxWidth: device === "mobile" ? "340px" : "440px",
          boxShadow: t.scheme === "dark" ? "0 24px 64px -16px rgba(0,0,0,0.5)" : "0 24px 64px -16px rgba(12,14,20,0.22)",
        }}
      >
        {onClose && (
          <button onClick={onClose}
            className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center z-10 transition-colors"
            style={{ background: t.closeBg }}>
            <X className="w-3.5 h-3.5" style={{ color: t.closeIcon }} />
          </button>
        )}
        {content}
      </div>
    </div>
  )
}

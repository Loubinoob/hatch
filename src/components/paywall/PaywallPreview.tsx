"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Check, X } from "lucide-react"

type Plan = {
  id: string
  name: string
  price_monthly: number
  price_yearly: number
  features: string[]
  is_popular: boolean
}

interface Props {
  config: {
    headline?: string
    subheadline?: string | null
    cta_copy?: string
    social_proof?: string | null
    show_yearly_toggle?: boolean
    closeable?: boolean
    template?: string
  }
  plans: Plan[]
  accentColor?: string
}

export default function PaywallPreview({ config, plans, accentColor = "#6366F1" }: Props) {
  const [yearly, setYearly] = useState(false)
  const [closed, setClosed] = useState(false)

  if (closed) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 text-center p-8">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
          <span className="text-2xl">🔒</span>
        </div>
        <p className="text-sm text-white/60">App content here</p>
        <button
          onClick={() => setClosed(false)}
          className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white/60 transition-colors"
        >
          Show paywall
        </button>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="absolute inset-4 flex items-center justify-center"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm rounded-xl" />

      {/* Modal */}
      <div className="relative bg-[#0F0F12] border border-white/10 rounded-2xl w-full max-w-sm mx-4 shadow-2xl overflow-hidden">
        {/* Close button */}
        {config.closeable !== false && (
          <button
            onClick={() => setClosed(true)}
            className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors z-10"
          >
            <X className="w-3.5 h-3.5 text-white/40" />
          </button>
        )}

        <div className="p-5">
          {/* Headline */}
          <h2 className="font-bold text-lg text-white leading-tight mb-1 pr-8">
            {config.headline ?? "Unlock the full power of your app"}
          </h2>

          {/* Subheadline */}
          {config.subheadline && (
            <p className="text-xs text-white/50 mb-3">{config.subheadline}</p>
          )}

          {/* Social proof */}
          {config.social_proof && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex -space-x-1.5">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="w-5 h-5 rounded-full border border-[#0F0F12]" style={{ background: `hsl(${i * 60}, 60%, 50%)` }} />
                ))}
              </div>
              <p className="text-[10px] text-white/40">{config.social_proof}</p>
            </div>
          )}

          {/* Yearly toggle */}
          {config.show_yearly_toggle !== false && plans.some(p => p.price_yearly > 0) && (
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className={`text-xs ${!yearly ? "text-white" : "text-white/40"}`}>Monthly</span>
              <button
                onClick={() => setYearly(!yearly)}
                className="relative w-10 h-5 rounded-full transition-colors"
                style={{ background: yearly ? accentColor : "rgba(255,255,255,0.1)" }}
              >
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${yearly ? "translate-x-5" : ""}`} />
              </button>
              <span className={`text-xs ${yearly ? "text-white" : "text-white/40"}`}>Yearly</span>
              {yearly && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${accentColor}20`, color: accentColor }}>
                  Save 20%
                </span>
              )}
            </div>
          )}

          {/* Plans */}
          <div className={`grid gap-2 ${plans.length > 2 ? "grid-cols-3" : plans.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
            {plans.slice(0, 3).map(plan => {
              const price = yearly && plan.price_yearly > 0
                ? Math.round(plan.price_yearly / 12 / 100)
                : Math.round(plan.price_monthly / 100)

              return (
                <div
                  key={plan.id}
                  className={`rounded-xl p-3 border transition-all cursor-pointer ${
                    plan.is_popular
                      ? "border-opacity-60"
                      : "border-white/8 bg-white/3"
                  }`}
                  style={plan.is_popular ? {
                    borderColor: `${accentColor}60`,
                    background: `${accentColor}10`,
                  } : {}}
                >
                  {plan.is_popular && (
                    <p className="text-[9px] font-semibold mb-1.5" style={{ color: accentColor }}>★ POPULAR</p>
                  )}
                  <p className="text-xs font-semibold text-white mb-1">{plan.name}</p>
                  <div className="mb-2">
                    <span className="text-xl font-bold text-white font-mono">${price}</span>
                    <span className="text-[9px] text-white/40">/mo</span>
                  </div>
                  <ul className="space-y-1 mb-3">
                    {(plan.features ?? []).slice(0, 3).map((f, i) => (
                      <li key={i} className="flex items-center gap-1 text-[9px] text-white/50">
                        <Check className="w-2.5 h-2.5 flex-shrink-0" style={{ color: accentColor }} />
                        <span className="truncate">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    className="w-full py-1.5 rounded-lg text-[11px] font-semibold text-white transition-all hover:opacity-90"
                    style={plan.is_popular ? { background: accentColor } : { background: "rgba(255,255,255,0.08)" }}
                  >
                    {config.cta_copy ?? "Get started"}
                  </button>
                </div>
              )
            })}
          </div>

          <p className="text-[9px] text-white/25 text-center mt-3">Cancel anytime · No hidden fees</p>
          <p className="text-[9px] text-white/20 text-center mt-0.5">Already a subscriber? <span className="underline">Sign in</span></p>
        </div>
      </div>
    </motion.div>
  )
}

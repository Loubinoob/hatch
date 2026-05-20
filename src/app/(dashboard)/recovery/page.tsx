"use client"

import { motion } from "framer-motion"
import { Mail, Clock, DollarSign, Zap } from "lucide-react"

const CAMPAIGNS = [
  {
    type: "trial_expiring",
    title: "Trial expiration",
    description: "Automatically email users before their trial ends",
    icon: Clock,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    steps: ["J-3: Reminder email", "J-1: Last chance", "J+0: Trial ended — upgrade offer"],
    status: "coming_soon",
  },
  {
    type: "failed_payment",
    title: "Failed payments",
    description: "Recover failed charges with smart retry sequences",
    icon: DollarSign,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    steps: ["Day 1: Card failed notification", "Day 3: Update payment method", "Day 7: Final warning"],
    status: "coming_soon",
  },
  {
    type: "churn_winback",
    title: "Churn win-back",
    description: "Re-engage canceled subscribers with time-limited offers",
    icon: Zap,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
    steps: ["J+7: 10% off offer", "J+30: 25% off offer", "J+90: 50% off offer"],
    status: "coming_soon",
  },
]

export default function RecoveryPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-white mb-1">Recovery</h1>
        <p className="text-sm text-[#71717A]">Automated sequences to recover at-risk and lost subscribers</p>
      </div>

      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 flex items-start gap-3 mb-6">
        <Mail className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-white mb-0.5">Recovery campaigns launching in Phase 2</p>
          <p className="text-xs text-[#71717A]">Configure automated email sequences to recover churned and at-risk subscribers. All sequences use Resend for delivery.</p>
        </div>
      </div>

      <div className="space-y-4">
        {CAMPAIGNS.map((campaign, i) => (
          <motion.div
            key={campaign.type}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`bg-[#111114] border ${campaign.border} rounded-xl p-5 opacity-60`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 ${campaign.bg} border ${campaign.border} rounded-xl flex items-center justify-center`}>
                  <campaign.icon className={`w-4 h-4 ${campaign.color}`} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">{campaign.title}</h3>
                  <p className="text-xs text-[#71717A]">{campaign.description}</p>
                </div>
              </div>
              <span className="text-[10px] font-medium bg-white/5 border border-white/10 text-[#52525B] px-2 py-0.5 rounded-full">
                Coming in Phase 2
              </span>
            </div>

            <div className="flex gap-2">
              {campaign.steps.map((step, si) => (
                <div key={si} className="flex items-center gap-2 flex-1">
                  <div className="flex-1 bg-white/3 border border-white/6 rounded-lg p-2.5">
                    <p className="text-[10px] font-medium text-[#52525B] mb-0.5">Step {si + 1}</p>
                    <p className="text-xs text-[#71717A]">{step}</p>
                  </div>
                  {si < campaign.steps.length - 1 && (
                    <div className="text-[#3F3F46] text-sm">→</div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

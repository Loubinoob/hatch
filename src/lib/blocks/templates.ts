import type { Block, DisplayMode, BlockTheme } from "./types"
import { makeBlock } from "./utils"

export type PaywallTemplate = {
  id:           string
  name:         string
  tagline:      string
  tone:         string
  displayMode:  DisplayMode
  theme:        Partial<BlockTheme>
  blocks:       Block[]
}

// ─── 1. Minimal Premium (Linear / Stripe vibe) ───────────────────────────────
const minimalPremium: PaywallTemplate = {
  id: "minimal-premium",
  name: "Minimal Premium",
  tagline: "Refined. Restrained. Trustworthy.",
  tone: "Premium SaaS",
  displayMode: "modal",
  theme: { accentColor: "#6366F1", fontFamily: "system", buttonShape: "rounded" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "Upgrade",
      headline: "Get more done with Pro",
      subheadline: "Unlock every feature with a single subscription. No tiers, no surprises.",
      alignment: "center",
      paddingY: "l",
      bgGradient: "linear-gradient(180deg, rgba(99,102,241,0.12), rgba(99,102,241,0))",
    }),
    makeBlock("plans", { ctaCopy: "Start free trial" }),
    makeBlock("guarantee", { text: "14-day free trial · Cancel anytime · No credit card required", paddingY: "s" }),
  ],
}

// ─── 2. Vibrant Fitness (energetic, transformation) ──────────────────────────
const vibrantFitness: PaywallTemplate = {
  id: "vibrant-fitness",
  name: "Vibrant Fitness",
  tagline: "Bold. Energetic. Results-oriented.",
  tone: "Fitness / Wellness",
  displayMode: "fullscreen",
  theme: { accentColor: "#10B981", fontFamily: "system", buttonShape: "pill" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "🔥 Transform in 90 days",
      headline: "Train smarter. Eat better. Win.",
      subheadline: "Access every workout, meal plan and coaching session. One subscription, every goal.",
      alignment: "center",
      paddingY: "l",
      bgGradient: "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(6,95,70,0.06))",
    }),
    makeBlock("stats", {
      items: [
        { value: "500+",  label: "Workouts" },
        { value: "4.9★",  label: "App store" },
        { value: "50K+",  label: "Members" },
      ],
      paddingY: "m",
    }),
    makeBlock("plans", { ctaCopy: "Start my transformation" }),
    makeBlock("testimonials", {
      title: "Real results from real people",
      items: [
        { quote: "Lost 12 kg in 3 months. The program just works.", author: "Thomas R.", role: "Member since 2024", avatar: null },
        { quote: "Finally an app that keeps me accountable.", author: "Julie M.", role: "Member since 2023", avatar: null },
      ],
    }),
    makeBlock("guarantee", { text: "7-day free trial · Cancel anytime · No commitments" }),
  ],
}

// ─── 3. Productivity SaaS (clean B2B) ────────────────────────────────────────
const productivitySaas: PaywallTemplate = {
  id: "productivity-saas",
  name: "Productivity SaaS",
  tagline: "Clean. Feature-focused. Comparison-driven.",
  tone: "B2B / Productivity",
  displayMode: "fullscreen",
  theme: { accentColor: "#3B82F6", fontFamily: "system", buttonShape: "rounded" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "Upgrade your workflow",
      headline: "Ship more, faster",
      subheadline: "Everything your team needs to move from idea to launch — in one workspace.",
      alignment: "left",
      paddingY: "l",
    }),
    makeBlock("features", {
      title: "What's included in Pro",
      items: [
        { icon: "zap",      text: "Unlimited projects, workspaces and members" },
        { icon: "trending", text: "Advanced analytics and team-level reports" },
        { icon: "sparkles", text: "AI-powered automation across every workflow" },
        { icon: "lock",     text: "Enterprise SSO, audit logs and SOC 2 compliance" },
      ],
    }),
    makeBlock("comparison", {
      title: "Free vs Pro",
      rows: [
        { feature: "Projects",         values: ["3",     "Unlimited"] },
        { feature: "Team members",     values: ["1",     "Unlimited"] },
        { feature: "Storage",          values: ["1 GB",  "100 GB"] },
        { feature: "Analytics",        values: ["Basic", "Advanced"] },
        { feature: "API access",       values: ["no",    "yes"] },
        { feature: "Priority support", values: ["no",    "yes"] },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Upgrade to Pro" }),
    makeBlock("faq", {
      title: "Common questions",
      items: [
        { question: "Can I switch plans anytime?", answer: "Yes — upgrade or downgrade at any time. We prorate billing automatically." },
        { question: "Do you offer team discounts?", answer: "Yes, contact us for teams of 10 or more — we offer volume pricing." },
        { question: "Is my data safe?", answer: "SOC 2 Type II certified, end-to-end encrypted, with optional EU data residency." },
      ],
    }),
  ],
}

// ─── 4. Gaming / Energetic (bold, urgent) ────────────────────────────────────
const gamingEnergetic: PaywallTemplate = {
  id: "gaming-energetic",
  name: "Gaming / Energetic",
  tagline: "Neon. Bold. High-conversion.",
  tone: "Gaming / Entertainment",
  displayMode: "fullscreen",
  theme: { accentColor: "#8B5CF6", fontFamily: "mono", buttonShape: "square" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "⚡ FOUNDER PRICING",
      headline: "LEVEL UP. NO LIMITS.",
      subheadline: "Unlock every feature, skin and mode. Elite access starts now.",
      alignment: "center",
      paddingY: "l",
      bgGradient: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(67,33,123,0.08))",
    }),
    makeBlock("stats", {
      items: [
        { value: "2M+",  label: "Players online" },
        { value: "99ms", label: "Avg latency" },
        { value: "24/7", label: "Global servers" },
      ],
    }),
    makeBlock("urgency", {
      text: "Founder pricing ends in 3 days",
      subtext: "After that, $14.99/mo standard",
    }),
    makeBlock("plans", { ctaCopy: "CLAIM ELITE ACCESS" }),
    makeBlock("testimonials", {
      title: "Players love it",
      items: [
        { quote: "Best upgrade I've made. The extra features are insane.", author: "xViper_99", role: "Diamond rank", avatar: null },
        { quote: "Worth every cent. Latency drop alone pays for itself.", author: "Ryksor", role: "Top 500", avatar: null },
      ],
    }),
    makeBlock("guarantee", { text: "72-hour full refund · No questions asked" }),
  ],
}

// ─── 5. Creator / Personal (warm, community) ─────────────────────────────────
const creatorPersonal: PaywallTemplate = {
  id: "creator-personal",
  name: "Creator Personal",
  tagline: "Warm, authentic, community-driven.",
  tone: "Creator Economy / Newsletter",
  displayMode: "modal",
  theme: { accentColor: "#F59E0B", fontFamily: "serif", buttonShape: "rounded" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "Join the inner circle",
      headline: "Become a member",
      subheadline: "Every essay, every archive, monthly live calls and the private community.",
      alignment: "center",
      paddingY: "l",
      bgGradient: "linear-gradient(180deg, rgba(245,158,11,0.10), rgba(245,158,11,0))",
    }),
    makeBlock("testimonials", {
      title: "What members say",
      items: [
        { quote: "Worth 10× the price. The community alone changed my career.", author: "Alex T.", role: "Member", avatar: null },
        { quote: "The best thing I subscribe to. I look forward to every drop.", author: "Priya D.", role: "Member since 2023", avatar: null },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Become a member" }),
    makeBlock("faq", {
      title: "Questions",
      items: [
        { question: "What do I get exactly?", answer: "All articles + archives, monthly live calls and the private Discord community." },
        { question: "Can I cancel?", answer: "Cancel any time from your account — no fees, no questions." },
      ],
    }),
  ],
}

// ─── 6. Neo-bank / Fintech (trust-first, premium dark) ───────────────────────
const neobankFintech: PaywallTemplate = {
  id: "neobank-fintech",
  name: "Neo-bank / Fintech",
  tagline: "Trust-first. Dark. Premium.",
  tone: "Fintech / Finance",
  displayMode: "fullscreen",
  theme: { accentColor: "#14B8A6", fontFamily: "system", buttonShape: "rounded" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "Premium tier",
      headline: "Banking that works as hard as you do",
      subheadline: "Unlimited transfers, metal card, cashback and concierge — one premium plan.",
      alignment: "left",
      paddingY: "l",
      bgGradient: "linear-gradient(135deg, rgba(20,184,166,0.14), rgba(8,51,68,0.04))",
    }),
    makeBlock("features", {
      title: "Premium benefits",
      items: [
        { icon: "crown",  text: "Metal card delivered in 48 hours" },
        { icon: "trending", text: "2% cashback on every purchase, no cap" },
        { icon: "sparkles", text: "Zero foreign transaction fees worldwide" },
        { icon: "shield", text: "Travel, phone, and rental insurance included" },
        { icon: "award",  text: "Dedicated 24/7 concierge service" },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Upgrade to Premium" }),
    makeBlock("logos", {
      title: "As seen in",
      items: [{ name: "TechCrunch" }, { name: "Forbes" }, { name: "Bloomberg" }, { name: "WIRED" }],
    }),
    makeBlock("guarantee", { text: "FSCS protected · Bank-grade encryption · ISO 27001 certified" }),
  ],
}

// ─── 7. Course / Education (transformation, curriculum) ──────────────────────
const courseEducation: PaywallTemplate = {
  id: "course-education",
  name: "Course / Education",
  tagline: "Curriculum-forward. Transformation-driven.",
  tone: "Online Course / EdTech",
  displayMode: "fullscreen",
  theme: { accentColor: "#EC4899", fontFamily: "system", buttonShape: "rounded" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "Now enrolling — Cohort 12",
      headline: "Master the skill that changes everything",
      subheadline: "12 modules · 40+ lessons · lifetime access · 5,000-strong community",
      alignment: "center",
      paddingY: "l",
      bgGradient: "linear-gradient(135deg, rgba(236,72,153,0.16), rgba(157,23,77,0.04))",
    }),
    makeBlock("features", {
      title: "What you'll learn",
      items: [
        { icon: "📘", text: "Module 1 — Foundations & mental models" },
        { icon: "🎯", text: "Module 2 — Hands-on projects with real feedback" },
        { icon: "🤝", text: "Module 3 — Building in public + accountability" },
        { icon: "🚀", text: "Module 4 — Monetisation playbook + templates" },
        { icon: "♾️", text: "Bonus — lifetime access + every future update" },
      ],
    }),
    makeBlock("testimonials", {
      title: "Student outcomes",
      items: [
        { quote: "Zero to first paying client in 6 weeks.", author: "Lena P.", role: "Graduate, Cohort 8", avatar: null },
        { quote: "The most practical course I've ever taken. 100% recommend.", author: "Ben A.", role: "Graduate, Cohort 10", avatar: null },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Enroll now" }),
    makeBlock("guarantee", { text: "30-day full refund — if you don't love it, you don't pay" }),
    makeBlock("faq", {
      title: "Course FAQ",
      items: [
        { question: "Is this suitable for beginners?", answer: "Absolutely. We start from the very basics and ramp up systematically." },
        { question: "How long do I have access?", answer: "Lifetime — including every future update at no extra charge." },
        { question: "Is there a certificate?", answer: "Yes, a verifiable LinkedIn-ready completion certificate." },
      ],
    }),
  ],
}

// ─── 8. AI / Tech Tool (data-forward, dev-focused) ───────────────────────────
const aiTechTool: PaywallTemplate = {
  id: "ai-tech-tool",
  name: "AI / Tech Tool",
  tagline: "Data-driven. Comparison-table. Developer-first.",
  tone: "AI / Developer Tool",
  displayMode: "fullscreen",
  theme: { accentColor: "#6366F1", fontFamily: "mono", buttonShape: "rounded" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "▲ Powered by Claude",
      headline: "10× your output with AI",
      subheadline: "Real-time data, AI reasoning and no-code automation — in a single CLI + API.",
      alignment: "left",
      paddingY: "l",
    }),
    makeBlock("stats", {
      items: [
        { value: "10×",   label: "Faster workflows" },
        { value: "99.9%", label: "Uptime SLA" },
        { value: "SOC 2", label: "Type II certified" },
      ],
    }),
    makeBlock("comparison", {
      title: "Starter vs Pro",
      rows: [
        { feature: "AI requests / mo",  values: ["500",          "Unlimited"] },
        { feature: "Integrations",      values: ["5",            "Unlimited"] },
        { feature: "Custom models",     values: ["no",           "yes"] },
        { feature: "Team workspace",    values: ["no",           "yes"] },
        { feature: "SLA",               values: ["Best-effort",  "99.9%"] },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Start free trial" }),
    makeBlock("faq", {
      title: "Technical FAQ",
      items: [
        { question: "Which AI models are available?", answer: "Claude Opus, Sonnet and Haiku — switch per request, no rate limits on Pro." },
        { question: "Is there rate limiting?", answer: "Pro users have no hard limits. Fair-use policy applies (10K req/day soft cap)." },
        { question: "Can I self-host?", answer: "Enterprise plan includes on-premise and air-gapped deployment options." },
      ],
    }),
  ],
}

// ─── 9. Simple Quick (express modal) ─────────────────────────────────────────
const simpleQuick: PaywallTemplate = {
  id: "simple-quick",
  name: "Simple Quick",
  tagline: "Minimal friction. Maximum conversion.",
  tone: "Express / Mobile App",
  displayMode: "modal",
  theme: { accentColor: "#6366F1", fontFamily: "system", buttonShape: "pill" },
  blocks: [
    makeBlock("hero", {
      headline: "Go Pro",
      subheadline: "Unlock everything for less than a coffee a month.",
      alignment: "center",
      paddingY: "m",
    }),
    makeBlock("plans", { ctaCopy: "Upgrade now" }),
    makeBlock("guarantee", { text: "Cancel anytime", paddingY: "s" }),
  ],
}

// ─── 10. Long-form Sales Page (max persuasion) ───────────────────────────────
const longformSales: PaywallTemplate = {
  id: "longform-sales",
  name: "Long-form Sales Page",
  tagline: "Maximum persuasion. Every objection handled.",
  tone: "High-ticket / Info Product",
  displayMode: "fullscreen",
  theme: { accentColor: "#EF4444", fontFamily: "system", buttonShape: "rounded" },
  blocks: [
    makeBlock("urgency", {
      text: "🔥 Founding member pricing — 50 spots left",
      paddingY: "s",
    }),
    makeBlock("hero", {
      eyebrow: "★ The #1 rated growth system",
      headline: "Stop struggling. Start scaling.",
      subheadline: "The proven 90-day system used by 10,000+ businesses to double their revenue.",
      alignment: "center",
      paddingY: "l",
      bgGradient: "linear-gradient(135deg, rgba(239,68,68,0.16), rgba(127,29,29,0.04))",
    }),
    makeBlock("stats", {
      items: [
        { value: "10K+", label: "Customers" },
        { value: "2×",   label: "Avg revenue lift" },
        { value: "90",   label: "Days to results" },
      ],
    }),
    makeBlock("features", {
      title: "Everything you need to succeed",
      items: [
        { icon: "🎯", text: "Step-by-step playbook proven across industries" },
        { icon: "🤝", text: "1-on-1 onboarding call with our growth team" },
        { icon: "📊", text: "Real-time dashboard with KPI tracking" },
        { icon: "💬", text: "Private Slack community (5,000+ members)" },
        { icon: "📚", text: "Weekly live sessions + complete resource library" },
      ],
    }),
    makeBlock("testimonials", {
      title: "Proof it works",
      items: [
        { quote: "Went from $5K to $50K MRR in 4 months. This is the real deal.", author: "Marcus J.", role: "Founder, SaaS", avatar: null },
        { quote: "Skeptical at first — now a true believer. Incredible ROI.", author: "Diana F.", role: "E-commerce", avatar: null },
        { quote: "The community alone is worth 10× the price.", author: "Yusuf A.", role: "Agency owner", avatar: null },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Claim your spot now" }),
    makeBlock("guarantee", { text: "60-day money-back guarantee — if you don't see results, we refund every cent" }),
    makeBlock("faq", {
      title: "Still have questions?",
      items: [
        { question: "Is this right for my stage?", answer: "We work with businesses from $0 to $10M ARR. If you're serious about growth, this is for you." },
        { question: "How quickly will I see results?", answer: "Most customers report measurable lift within the first 30 days." },
        { question: "What if it doesn't work for me?", answer: "Full refund, no questions, within 60 days. Zero risk on your end." },
      ],
    }),
  ],
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const PAYWALL_TEMPLATES: PaywallTemplate[] = [
  minimalPremium,
  vibrantFitness,
  productivitySaas,
  gamingEnergetic,
  creatorPersonal,
  neobankFintech,
  courseEducation,
  aiTechTool,
  simpleQuick,
  longformSales,
]

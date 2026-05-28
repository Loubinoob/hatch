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

// ─── 1. Minimal Premium ──────────────────────────────────────────────────────
const minimalPremium: PaywallTemplate = {
  id: "minimal-premium",
  name: "Minimal Premium",
  tagline: "Refined. Dark. Trustworthy.",
  tone: "Premium SaaS",
  displayMode: "modal",
  theme: { accentColor: "#6366F1", fontFamily: "system", buttonShape: "rounded" },
  blocks: [
    makeBlock("hero", {
      headline: "Upgrade to Pro",
      subheadline: "Unlock every feature with a single subscription.",
      alignment: "center",
    }),
    makeBlock("plans", { ctaCopy: "Start free trial" }),
    makeBlock("guarantee", { text: "30-day money-back guarantee — cancel anytime" }),
  ],
}

// ─── 2. Vibrant Fitness ──────────────────────────────────────────────────────
const vibrantFitness: PaywallTemplate = {
  id: "vibrant-fitness",
  name: "Vibrant Fitness",
  tagline: "Bold, energetic, results-oriented.",
  tone: "Fitness / Wellness",
  displayMode: "fullscreen",
  theme: { accentColor: "#10B981", fontFamily: "system", buttonShape: "pill" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "🔥 Transform your training",
      headline: "Train Smarter, Not Harder",
      subheadline: "Access all workouts, nutrition plans and coaching — one flat price.",
      alignment: "center",
    }),
    makeBlock("stats", {
      items: [
        { value: "500+", label: "Workouts" },
        { value: "4.9★", label: "App store rating" },
        { value: "50K+", label: "Active members" },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Start my transformation" }),
    makeBlock("testimonials", {
      title: "Real results from real people",
      items: [
        { quote: "Lost 12 kg in 3 months following the program.", author: "Thomas R.", role: "Member since 2024", avatar: null },
        { quote: "Finally an app that keeps me accountable.", author: "Julie M.", role: "Member since 2023", avatar: null },
      ],
    }),
    makeBlock("guarantee", { text: "7-day free trial · Cancel anytime · No commitments" }),
  ],
}

// ─── 3. Productivity SaaS ────────────────────────────────────────────────────
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
      headline: "Work faster with Pro",
      subheadline: "Everything your team needs to ship more, faster.",
      alignment: "left",
    }),
    makeBlock("features", {
      title: "What's included in Pro",
      items: [
        { icon: "⚡", text: "Unlimited projects & workspaces" },
        { icon: "📊", text: "Advanced analytics and reports" },
        { icon: "🔌", text: "Integrations with 50+ tools" },
        { icon: "🤖", text: "AI-powered automation" },
        { icon: "🔒", text: "Enterprise SSO & audit logs" },
      ],
    }),
    makeBlock("comparison", {
      title: "Free vs Pro",
      rows: [
        { feature: "Projects",       values: ["3",    "Unlimited"] },
        { feature: "Team members",   values: ["1",    "Unlimited"] },
        { feature: "Storage",        values: ["1 GB", "100 GB"] },
        { feature: "Analytics",      values: ["Basic","Advanced"] },
        { feature: "API access",     values: ["✗",    "✓"] },
        { feature: "Priority support",values: ["✗",   "✓"] },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Upgrade to Pro" }),
    makeBlock("faq", {
      title: "Common questions",
      items: [
        { question: "Can I switch plans anytime?", answer: "Yes, upgrade or downgrade at any time — prorated billing applies." },
        { question: "Do you offer team discounts?", answer: "Yes — contact us for teams of 10 or more." },
        { question: "Is my data safe?", answer: "SOC 2 certified, end-to-end encrypted, EU data residency available." },
      ],
    }),
  ],
}

// ─── 4. Gaming / Energetic ───────────────────────────────────────────────────
const gamingEnergetic: PaywallTemplate = {
  id: "gaming-energetic",
  name: "Gaming / Energetic",
  tagline: "Neon. Bold. High-conversion.",
  tone: "Gaming / Entertainment",
  displayMode: "fullscreen",
  theme: { accentColor: "#8B5CF6", fontFamily: "mono", buttonShape: "square" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "⚡ LIMITED TIME OFFER",
      headline: "Level Up. No Limits.",
      subheadline: "Unlock every feature, skin and mode. Elite access starts now.",
      alignment: "center",
    }),
    makeBlock("stats", {
      items: [
        { value: "2M+",  label: "Players" },
        { value: "99ms", label: "Latency" },
        { value: "24/7", label: "Servers" },
      ],
    }),
    makeBlock("urgency", {
      text: "Founder pricing ends in",
      type: "countdown",
      endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    makeBlock("plans", { ctaCopy: "CLAIM ACCESS NOW" }),
    makeBlock("testimonials", {
      title: "Players love it",
      items: [
        { quote: "Best upgrade I've made — the extra features are insane.", author: "xViper_99", role: "Diamond rank", avatar: null },
        { quote: "Worth every cent. The lag reduction alone pays for itself.", author: "Ryksor", role: "Top 500", avatar: null },
      ],
    }),
    makeBlock("guarantee", { text: "72-hour refund, no questions asked" }),
  ],
}

// ─── 5. Creator / Personal ───────────────────────────────────────────────────
const creatorPersonal: PaywallTemplate = {
  id: "creator-personal",
  name: "Creator Personal",
  tagline: "Warm, authentic, community-driven.",
  tone: "Creator Economy / Newsletter",
  displayMode: "modal",
  theme: { accentColor: "#F59E0B", fontFamily: "serif", buttonShape: "rounded" },
  blocks: [
    makeBlock("hero", {
      headline: "Join the community",
      subheadline: "Get exclusive access to all content, monthly calls and the private community.",
      alignment: "center",
    }),
    makeBlock("testimonials", {
      title: "What members say",
      items: [
        { quote: "Worth 10× the price. The community alone changed my career.", author: "Alex T.", role: "Member", avatar: null },
        { quote: "I look forward to every new post. Genuinely the best thing I subscribe to.", author: "Priya D.", role: "Member since 2023", avatar: null },
        { quote: "Opened my eyes to opportunities I didn't know existed.", author: "Chris W.", role: "Member", avatar: null },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Become a member" }),
    makeBlock("faq", {
      title: "Questions",
      items: [
        { question: "What do I get?", answer: "All articles, archives, monthly live calls and the private Discord." },
        { question: "Can I cancel?", answer: "Cancel anytime from your account settings. No fees, no questions." },
      ],
    }),
  ],
}

// ─── 6. Neo-bank / Fintech ───────────────────────────────────────────────────
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
      subheadline: "Unlimited transfers, metal card, cashback and concierge — in one plan.",
      alignment: "left",
    }),
    makeBlock("features", {
      title: "Premium benefits",
      items: [
        { icon: "💳", text: "Metal card, delivered in 2 days" },
        { icon: "💸", text: "2% cashback on all purchases" },
        { icon: "🌍", text: "No foreign transaction fees" },
        { icon: "🔒", text: "Insurance: travel, phone, rental" },
        { icon: "📞", text: "Dedicated concierge 24/7" },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Upgrade to Premium" }),
    makeBlock("logos", {
      title: "Trusted by 2M+ users worldwide",
      items: [{ name: "TechCrunch" }, { name: "Forbes" }, { name: "Bloomberg" }],
    }),
    makeBlock("guarantee", { text: "FSCS protected · Bank-grade encryption · ISO 27001" }),
  ],
}

// ─── 7. Course / Education ───────────────────────────────────────────────────
const courseEducation: PaywallTemplate = {
  id: "course-education",
  name: "Course / Education",
  tagline: "Curriculum-forward, transformation-driven.",
  tone: "Online Course / EdTech",
  displayMode: "fullscreen",
  theme: { accentColor: "#EC4899", fontFamily: "system", buttonShape: "rounded" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "Enroll now",
      headline: "Master the skill that changes everything",
      subheadline: "12 modules, 40+ lessons, lifetime access and a community of 5 000 learners.",
      alignment: "center",
    }),
    makeBlock("features", {
      title: "What you'll learn",
      items: [
        { icon: "📘", text: "Module 1 — Foundations & mental models" },
        { icon: "🎯", text: "Module 2 — Hands-on projects" },
        { icon: "🤝", text: "Module 3 — Building in public" },
        { icon: "🚀", text: "Module 4 — Monetisation strategies" },
        { icon: "♾️", text: "Bonus — lifetime access + future updates" },
      ],
    }),
    makeBlock("testimonials", {
      title: "Student results",
      items: [
        { quote: "Went from zero to first paying client in 6 weeks.", author: "Lena P.", role: "Graduate", avatar: null },
        { quote: "The most practical course I've ever taken. 100% recommend.", author: "Ben A.", role: "Graduate", avatar: null },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Enroll now" }),
    makeBlock("guarantee", { text: "30-day full refund — if you don't love it, you pay nothing" }),
    makeBlock("faq", {
      title: "Course FAQ",
      items: [
        { question: "Is this suitable for beginners?", answer: "Absolutely — we start from the very basics." },
        { question: "How long do I have access?", answer: "Lifetime access, including all future updates." },
        { question: "Is there a certificate?", answer: "Yes, a verifiable completion certificate on LinkedIn." },
      ],
    }),
  ],
}

// ─── 8. AI / Tech Tool ───────────────────────────────────────────────────────
const aiTechTool: PaywallTemplate = {
  id: "ai-tech-tool",
  name: "AI / Tech Tool",
  tagline: "Data-driven, comparison table, tech-forward.",
  tone: "AI / Developer Tool",
  displayMode: "fullscreen",
  theme: { accentColor: "#6366F1", fontFamily: "mono", buttonShape: "rounded" },
  blocks: [
    makeBlock("hero", {
      eyebrow: "Powered by Claude AI",
      headline: "10× your output with AI",
      subheadline: "The only tool that combines real-time data, AI reasoning and no-code automation.",
      alignment: "left",
    }),
    makeBlock("stats", {
      items: [
        { value: "10×",   label: "Faster workflows" },
        { value: "99.9%", label: "Uptime SLA" },
        { value: "SOC 2", label: "Certified" },
      ],
    }),
    makeBlock("comparison", {
      title: "Starter vs Pro",
      rows: [
        { feature: "AI requests / mo",  values: ["500",       "Unlimited"] },
        { feature: "Integrations",      values: ["5",         "Unlimited"] },
        { feature: "Custom models",     values: ["✗",         "✓"] },
        { feature: "Team workspace",    values: ["✗",         "✓"] },
        { feature: "SLA",               values: ["Best-effort","99.9%"] },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Start free trial" }),
    makeBlock("faq", {
      title: "Technical FAQ",
      items: [
        { question: "Which AI models are available?", answer: "Claude Opus, Sonnet and Haiku — switch per request." },
        { question: "Is there rate limiting?", answer: "Pro users have no hard limits — fair-use policy applies." },
        { question: "Can I self-host?", answer: "Enterprise plan includes on-premise deployment." },
      ],
    }),
  ],
}

// ─── 9. Simple Quick ─────────────────────────────────────────────────────────
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
      subheadline: "Unlock all features for less than a coffee a month.",
      alignment: "center",
    }),
    makeBlock("plans", { ctaCopy: "Upgrade now" }),
  ],
}

// ─── 10. Long-form Sales Page ─────────────────────────────────────────────────
const longformSales: PaywallTemplate = {
  id: "longform-sales",
  name: "Long-form Sales Page",
  tagline: "Maximum persuasion. Every objection handled.",
  tone: "High-ticket / Info Product",
  displayMode: "fullscreen",
  theme: { accentColor: "#EF4444", fontFamily: "system", buttonShape: "rounded" },
  blocks: [
    makeBlock("urgency", {
      text: "🔥 Founding member pricing — only 50 spots left",
      type: "text",
    }),
    makeBlock("hero", {
      eyebrow: "The #1 rated solution",
      headline: "Stop struggling. Start scaling.",
      subheadline: "The proven system used by 10 000+ businesses to double revenue in 90 days.",
      alignment: "center",
    }),
    makeBlock("stats", {
      items: [
        { value: "10K+", label: "Customers" },
        { value: "2×",   label: "Average revenue increase" },
        { value: "90",   label: "Days to results" },
      ],
    }),
    makeBlock("features", {
      title: "Everything you need to succeed",
      items: [
        { icon: "🎯", text: "Step-by-step playbook proven to work" },
        { icon: "🤝", text: "1-on-1 onboarding call with our team" },
        { icon: "📊", text: "Real-time dashboard & KPI tracking" },
        { icon: "💬", text: "Private Slack community (5 000 members)" },
        { icon: "📚", text: "Resource library + weekly live sessions" },
      ],
    }),
    makeBlock("testimonials", {
      title: "Proof it works",
      items: [
        { quote: "Went from $5K to $50K MRR in 4 months. This is the real deal.", author: "Marcus J.", role: "Founder, SaaS co.", avatar: null },
        { quote: "I was skeptical at first — now I'm a true believer. Incredible ROI.", author: "Diana F.", role: "E-commerce entrepreneur", avatar: null },
        { quote: "The community alone is worth 10× the price.", author: "Yusuf A.", role: "Agency owner", avatar: null },
      ],
    }),
    makeBlock("plans", { ctaCopy: "Claim your spot now" }),
    makeBlock("guarantee", { text: "60-day money-back guarantee — if you don't see results, we refund every penny" }),
    makeBlock("faq", {
      title: "Still have questions?",
      items: [
        { question: "Is this right for my stage?", answer: "We work with businesses from $0 to $10M ARR. If you're serious about growth, it's for you." },
        { question: "How quickly will I see results?", answer: "Most customers report measurable results within 30 days." },
        { question: "What if it doesn't work for me?", answer: "Full refund, no questions, within 60 days. Zero risk." },
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

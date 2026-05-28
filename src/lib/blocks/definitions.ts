import type { BlockDefinition, BlockType } from "./types"

// ─── Default props + prop schema per block type ───────────────────────────────

export const BLOCK_DEFINITIONS: Record<BlockType, BlockDefinition> = {

  hero: {
    label: "Hero",
    icon: "✨",
    defaultProps: {
      eyebrow:    null,
      headline:   "Unlock the full power",
      subheadline: "Join thousands of users who already leveled up.",
      alignment:  "center",
      bgImage:    null,
    },
    propSchema: [
      { key: "eyebrow",     label: "Eyebrow label",  type: "text",    placeholder: "e.g. Limited time offer" },
      { key: "headline",    label: "Headline",        type: "textarea" },
      { key: "subheadline", label: "Subheadline",     type: "textarea" },
      { key: "alignment",   label: "Alignment",       type: "enum", options: ["left", "center"] },
      { key: "bgImage",     label: "Background image (URL)", type: "image_url" },
    ],
  },

  plans: {
    label: "Pricing Plans",
    icon: "💳",
    defaultProps: {
      layout:        "cards",
      yearlyToggle:  true,
      ctaCopy:       "Get started",
    },
    propSchema: [
      { key: "layout",       label: "Layout",        type: "enum", options: ["cards", "list"] },
      { key: "yearlyToggle", label: "Yearly toggle", type: "boolean" },
      { key: "ctaCopy",      label: "CTA button",    type: "text", placeholder: "Get started" },
    ],
  },

  features: {
    label: "Features",
    icon: "⚡",
    defaultProps: {
      title: "Everything you need",
      items: [
        { icon: "✓", text: "Unlimited projects" },
        { icon: "✓", text: "Advanced analytics" },
        { icon: "✓", text: "Priority support" },
        { icon: "✓", text: "API access" },
      ],
    },
    propSchema: [
      { key: "title", label: "Section title", type: "text" },
      {
        key: "items", label: "Feature items", type: "items",
        itemSchema: [
          { key: "icon", label: "Icon (emoji)", type: "text",     placeholder: "✓" },
          { key: "text", label: "Feature text", type: "text" },
        ],
      },
    ],
  },

  testimonials: {
    label: "Testimonials",
    icon: "💬",
    defaultProps: {
      title: "Loved by thousands",
      items: [
        { quote: "This changed how we work. Absolutely worth it.", author: "Sarah K.", role: "Founder", avatar: null },
        { quote: "The best investment I made this year.", author: "Marc L.", role: "CTO", avatar: null },
      ],
    },
    propSchema: [
      { key: "title", label: "Section title", type: "text" },
      {
        key: "items", label: "Testimonials", type: "items",
        itemSchema: [
          { key: "quote",  label: "Quote",  type: "textarea" },
          { key: "author", label: "Author", type: "text" },
          { key: "role",   label: "Role",   type: "text" },
          { key: "avatar", label: "Avatar URL", type: "image_url" },
        ],
      },
    ],
  },

  logos: {
    label: "Logo Wall",
    icon: "🏢",
    defaultProps: {
      title: "Trusted by teams at",
      items: [
        { name: "Acme Corp" },
        { name: "Globex" },
        { name: "Initech" },
        { name: "Umbrella" },
      ],
    },
    propSchema: [
      { key: "title", label: "Title text", type: "text" },
      {
        key: "items", label: "Companies", type: "items",
        itemSchema: [
          { key: "name",     label: "Company name", type: "text" },
          { key: "logo_url", label: "Logo URL",     type: "image_url" },
        ],
      },
    ],
  },

  comparison: {
    label: "Comparison Table",
    icon: "📊",
    defaultProps: {
      title: "Compare plans",
      rows: [
        { feature: "Projects", values: ["3", "Unlimited"] },
        { feature: "Team members", values: ["1", "10"] },
        { feature: "Analytics", values: ["Basic", "Advanced"] },
        { feature: "API access", values: ["✗", "✓"] },
        { feature: "Priority support", values: ["✗", "✓"] },
      ],
    },
    propSchema: [
      { key: "title", label: "Table title", type: "text" },
      {
        key: "rows", label: "Comparison rows", type: "items",
        itemSchema: [
          { key: "feature", label: "Feature name", type: "text" },
        ],
      },
    ],
  },

  faq: {
    label: "FAQ",
    icon: "❓",
    defaultProps: {
      title: "Frequently asked",
      items: [
        { question: "Can I cancel anytime?", answer: "Yes — cancel with one click, no questions asked." },
        { question: "What payment methods do you accept?", answer: "All major cards and PayPal via Stripe." },
        { question: "Is there a free trial?", answer: "Yes, 14 days free on all plans. No credit card required." },
      ],
    },
    propSchema: [
      { key: "title", label: "Section title", type: "text" },
      {
        key: "items", label: "Questions", type: "items",
        itemSchema: [
          { key: "question", label: "Question", type: "text" },
          { key: "answer",   label: "Answer",   type: "textarea" },
        ],
      },
    ],
  },

  urgency: {
    label: "Urgency",
    icon: "⏰",
    defaultProps: {
      text:    "Limited offer — ends soon",
      subtext: null,
      type:    "text",
      endDate: null,
    },
    propSchema: [
      { key: "text",    label: "Urgency text", type: "text" },
      { key: "subtext", label: "Sub-text",     type: "text", placeholder: "Optional" },
      { key: "type",    label: "Style",        type: "enum", options: ["text", "countdown"] },
      { key: "endDate", label: "End date (ISO)", type: "text", placeholder: "2025-12-31T23:59:59Z" },
    ],
  },

  guarantee: {
    label: "Guarantee",
    icon: "🛡️",
    defaultProps: {
      text: "30-day money-back guarantee — no risk, no questions",
      icon: "shield",
    },
    propSchema: [
      { key: "text", label: "Guarantee text", type: "textarea" },
      { key: "icon", label: "Icon style",     type: "enum", options: ["shield", "star", "check"] },
    ],
  },

  video: {
    label: "Video",
    icon: "🎬",
    defaultProps: {
      url:       "",
      title:     "See it in action",
      autoplay:  false,
    },
    propSchema: [
      { key: "url",      label: "Video URL (YouTube / Loom)", type: "text" },
      { key: "title",    label: "Caption",                    type: "text" },
      { key: "autoplay", label: "Autoplay",                   type: "boolean" },
    ],
  },

  stats: {
    label: "Stats",
    icon: "📈",
    defaultProps: {
      items: [
        { value: "10K+", label: "Active users" },
        { value: "4.9★", label: "Average rating" },
        { value: "99%",  label: "Uptime" },
      ],
    },
    propSchema: [
      {
        key: "items", label: "Stats", type: "items",
        itemSchema: [
          { key: "value", label: "Value", type: "text", placeholder: "10K+" },
          { key: "label", label: "Label", type: "text", placeholder: "Active users" },
        ],
      },
    ],
  },

  footer: {
    label: "Footer",
    icon: "📄",
    defaultProps: {
      text:           "Cancel anytime · No hidden fees · Secure payment",
      showPoweredBy:  false,
    },
    propSchema: [
      { key: "text",          label: "Footer text",     type: "text" },
      { key: "showPoweredBy", label: "Show Powered by Hatch", type: "boolean" },
    ],
  },
}

/** Ordered list for the block picker (most commonly used first) */
export const BLOCK_PICKER_ORDER: BlockType[] = [
  "hero", "plans", "features", "testimonials",
  "guarantee", "urgency", "stats", "faq",
  "logos", "comparison", "video", "footer",
]

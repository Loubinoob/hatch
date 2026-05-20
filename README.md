# Hatch — Paywall SDK for AI-built apps

> Add a paywall to your Lovable, Bolt, or Replit app in one line of code.

## What is Hatch?

Hatch is the monetization layer for the new generation of AI-built apps. Founders paste one script tag, connect their Stripe, and get a fully optimized paywall — analytics-tracked, conversion-optimized, with automated recovery emails.

**Revenue model:** 1% commission on revenue processed, collected automatically via Stripe Connect.

---

## Setup

### 1. Clone and install

```bash
cd hatch
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# Fill in your Supabase, Stripe, and Resend credentials
```

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API Keys |
| `STRIPE_CLIENT_ID` | Stripe → Connect → Settings |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → your endpoint |
| `RESEND_API_KEY` | resend.com → API Keys |

### 3. Run Supabase migration

Paste the contents of `supabase/migrations/001_initial_schema.sql` into the Supabase SQL editor, or run:

```bash
supabase db push < supabase/migrations/001_initial_schema.sql
```

### 4. Configure Stripe Connect

1. Go to Stripe Connect settings → enable OAuth
2. Add redirect URI: `https://yourdomain.com/api/stripe/callback`
3. Copy `client_id` → `STRIPE_CLIENT_ID`

### 5. Configure Stripe Webhook

Point to: `https://yourdomain.com/api/webhooks/stripe`

Subscribe to: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

### 6. Run

```bash
npm run dev
# → http://localhost:3000
```

---

## SDK Integration

### HTML / Lovable

```html
<script async src="https://cdn.hatch.io/v1/sdk.js" data-key="pk_live_YOUR_KEY"></script>
```

### React / Next.js

```tsx
import { HatchProvider } from '@hatch/react'
<HatchProvider apiKey="pk_live_YOUR_KEY"><App /></HatchProvider>
```

### API

```js
hatch.identify('user_123', { email: 'user@example.com' })
hatch.track('ai_generation_done', { count: 3 })
hatch.show('paywall_id')       // Show a specific paywall
hatch.hide()
const sub = await hatch.getSubscription()
// { status: 'active', plan: { name: 'Pro' }, isActive: true }
```

---

## Architecture

```
src/app/
├── (auth)/           # Login, signup
├── (dashboard)/      # All founder-facing pages
│   ├── dashboard/    # KPI cards, MRR chart, live activity
│   ├── paywalls/     # Paywall builder (3-panel layout)
│   ├── plans/        # Plan management → Stripe sync
│   ├── customers/    # Subscriber list + churn risk
│   ├── analytics/    # Conversion funnel + revenue chart
│   ├── recovery/     # Email campaigns (Phase 2)
│   └── settings/     # Account, Stripe, API keys
├── api/
│   ├── stripe/       # Connect OAuth + checkout session
│   ├── sdk/          # Config, events, subscription endpoints
│   └── webhooks/     # Stripe webhook → commission calc
└── onboarding/       # 4-step wizard

public/sdk/sdk.js     # Vanilla JS SDK (auto-init from data-key)
supabase/migrations/  # Full DB schema with RLS policies
```

## Phase 1 Shipped ✓

- Auth (email + Google OAuth) + 4-step onboarding
- Stripe Connect (founder stays merchant, 1% auto-commission)
- Plan management + paywall builder with live preview
- Classic modal template + manual trigger
- Dashboard: MRR chart, live events feed, KPI cards
- Customer list with churn risk scores
- Stripe webhook → commission calculation + founder email notification
- Vanilla JS SDK with auto-init, identify, track, show, getSubscription
- Resend transactional emails

## Phase 2 Roadmap

- Visual rule builder (event-based, time-based triggers)
- A/B testing engine with Bayesian significance
- 5+ paywall templates
- Recovery email campaigns (trial expiry, failed payment, churn win-back)
- Full cohort retention heatmap

## Phase 3 Roadmap

- AI-powered paywall optimizer
- Native Lovable/Bolt platform integrations
- React Native SDK
- Public API

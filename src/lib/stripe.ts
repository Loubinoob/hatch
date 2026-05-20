import Stripe from "stripe"

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder", {
      apiVersion: "2026-04-22.dahlia",
    })
  }
  return _stripe
}

// Keep named export for convenience
export const stripe = {
  get oauth() { return getStripe().oauth },
  get webhooks() { return getStripe().webhooks },
  get checkout() { return getStripe().checkout },
  get oauth2() { return getStripe() },
} as unknown as Stripe

export const HATCH_COMMISSION_RATE = 0.01 // 1%

export function getStripeConnectUrl(_accountId: string, state: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.STRIPE_CLIENT_ID ?? "",
    scope: "read_write",
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/callback`,
    state,
    "stripe_user[business_type]": "individual",
  })
  return `https://connect.stripe.com/oauth/authorize?${params}`
}

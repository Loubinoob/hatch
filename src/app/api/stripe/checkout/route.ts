import { NextRequest, NextResponse } from "next/server"
import { getStripe, HATCH_COMMISSION_RATE } from "@/lib/stripe"
import { createServiceClient } from "@/lib/supabase/service"

export const dynamic = "force-dynamic"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(request: NextRequest) {
  try {
    const stripe = getStripe()
    const body = await request.json()
    const { paywallId, planId, userId, email, successUrl, cancelUrl, yearly } = body

    console.log(`[stripe/checkout] Request — planId: ${planId}, yearly: ${!!yearly}, user: ${userId ?? "anon"}`)

    if (!planId || !successUrl) {
      return NextResponse.json({ error: "Missing required fields: planId and successUrl" }, { status: 400, headers: CORS })
    }

    // Use service client — called from external SDK without a user session
    const supabase = createServiceClient()

    // Fetch plan (forward FK: plans.account_id → accounts, so accounts(id) resolves)
    const { data: plan } = await supabase
      .from("plans")
      .select("*, accounts(id)")
      .eq("id", planId)
      .single()

    if (!plan) {
      console.error(`[stripe/checkout] Plan not found: ${planId}`)
      return NextResponse.json({ error: "Plan not found" }, { status: 404, headers: CORS })
    }

    const accountId = (plan.accounts as { id: string } | null)?.id ?? plan.account_id
    const { data: conn } = await supabase
      .from("stripe_connections")
      .select("stripe_account_id")
      .eq("account_id", accountId)
      .single()

    if (!conn) {
      console.error(`[stripe/checkout] Stripe not connected for account: ${accountId}`)
      return NextResponse.json({ error: "Stripe not connected for this account" }, { status: 400, headers: CORS })
    }

    // Pick monthly vs yearly pricing
    const useYearly = !!yearly && (plan.price_yearly ?? 0) > 0
    const priceId = useYearly
      ? (plan.stripe_price_id_yearly || plan.stripe_price_id_monthly)
      : plan.stripe_price_id_monthly
    const amount = useYearly ? (plan.price_yearly ?? 0) : (plan.price_monthly ?? 0)
    const billingInterval: "month" | "year" = useYearly ? "year" : "month"

    console.log(`[stripe/checkout] Creating session — plan: "${plan.name}", amount: ${amount}¢, interval: ${billingInterval}, stripeAccount: ${conn.stripe_account_id}`)

    // Create Stripe Checkout session on the founder's connected Stripe account.
    // NOTE: payment_intent_data is NOT allowed in subscription mode — use
    // subscription_data.application_fee_percent instead.
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer_email: email || undefined,
        line_items: [
          priceId
            ? { price: priceId, quantity: 1 }
            : {
                price_data: {
                  currency: "usd",
                  product_data: { name: plan.name },
                  unit_amount: amount,
                  recurring: { interval: billingInterval },
                },
                quantity: 1,
              },
        ],
        subscription_data: {
          application_fee_percent: HATCH_COMMISSION_RATE * 100,
          metadata: {
            hatch_plan_id: planId,
            hatch_paywall_id: paywallId ?? "",
            hatch_user_id: userId ?? "",
          },
        },
        metadata: {
          hatch_plan_id: planId,
          hatch_paywall_id: paywallId ?? "",
          hatch_user_id: userId ?? "",
        },
        success_url: successUrl,
        cancel_url: cancelUrl ?? successUrl,
      },
      { stripeAccount: conn.stripe_account_id }
    )

    console.log(`[stripe/checkout] Session created: ${session.id}`)
    return NextResponse.json({ url: session.url }, { headers: CORS })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[stripe/checkout] Error:", msg)
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS })
  }
}

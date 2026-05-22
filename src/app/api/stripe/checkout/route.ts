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
  const stripe = getStripe()
  const { paywallId, planId, userId, email, successUrl, cancelUrl } = await request.json()

  if (!planId || !successUrl) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400, headers: CORS })
  }

  // Use service client — called from external SDK without a user session
  const supabase = createServiceClient()

  const { data: plan } = await supabase
    .from("plans")
    .select("*, accounts(id)")
    .eq("id", planId)
    .single()

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404, headers: CORS })

  const { data: conn } = await supabase
    .from("stripe_connections")
    .select("stripe_account_id")
    .eq("account_id", (plan.accounts as { id: string }).id)
    .single()

  if (!conn) return NextResponse.json({ error: "Stripe not connected" }, { status: 400, headers: CORS })

  const priceId = plan.stripe_price_id_monthly
  const amount = plan.price_monthly

  // Create Stripe checkout session on founder's connected account
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer_email: email,
      line_items: [
        priceId
          ? { price: priceId, quantity: 1 }
          : {
              price_data: {
                currency: "usd",
                product_data: { name: plan.name },
                unit_amount: amount,
                recurring: { interval: "month" },
              },
              quantity: 1,
            },
      ],
      payment_intent_data: {
        application_fee_amount: Math.round(amount * HATCH_COMMISSION_RATE),
      },
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

  return NextResponse.json({ url: session.url }, { headers: CORS })
}

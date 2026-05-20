import { NextRequest, NextResponse } from "next/server"
import { getStripe, HATCH_COMMISSION_RATE } from "@/lib/stripe"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { sendNewSubscriberEmail } from "@/lib/resend"

export const dynamic = "force-dynamic"

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get("stripe-signature")!

  const stripe = getStripe()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const supabase = getServiceClient()

  // Use any casts since Stripe v17+ restructured type namespacing
  /* eslint-disable @typescript-eslint/no-explicit-any */
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(supabase, event.data.object as any, event.account)
      break
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionChange(supabase, event.data.object as any, event.account)
      break
    case "invoice.payment_failed":
      await handlePaymentFailed(supabase, event.data.object as any, event.account)
      break
  }

  return NextResponse.json({ received: true })
}

type SupabaseClient = ReturnType<typeof getServiceClient>

async function handleCheckoutCompleted(supabase: SupabaseClient, session: any, stripeAccountId?: string) {
  const meta = session.metadata ?? {}
  const hatchPlanId = meta.hatch_plan_id
  const hatchUserId = meta.hatch_user_id
  const hatchPaywallId = meta.hatch_paywall_id

  if (!hatchPlanId) return

  const { data: conn } = await supabase
    .from("stripe_connections")
    .select("account_id")
    .eq("stripe_account_id", stripeAccountId ?? "")
    .single()

  if (!conn) return

  const accountId = conn.account_id
  const amount: number = session.amount_total ?? 0

  const { data: subscriber } = await supabase
    .from("subscribers")
    .upsert({
      account_id: accountId,
      external_user_id: hatchUserId ?? null,
      email: session.customer_email,
      stripe_customer_id: session.customer,
      plan_id: hatchPlanId,
      subscription_status: "active",
      ltv_cents: amount,
    }, { onConflict: "account_id,email" })
    .select()
    .single()

  if (session.subscription) {
    await supabase.from("subscriptions").insert({
      account_id: accountId,
      subscriber_id: subscriber?.id,
      plan_id: hatchPlanId,
      stripe_subscription_id: session.subscription,
      stripe_customer_id: session.customer,
      status: "active",
      amount_cents: amount,
      interval: "month",
    })
  }

  const commissionCents = Math.round(amount * HATCH_COMMISSION_RATE)
  await supabase.from("commissions").insert({
    account_id: accountId,
    gross_cents: amount,
    commission_cents: commissionCents,
    status: "paid",
  })

  if (hatchPaywallId) {
    const { data: pw } = await supabase.from("paywalls").select("conversions, revenue_cents").eq("id", hatchPaywallId).single()
    if (pw) {
      await supabase.from("paywalls").update({
        conversions: (pw.conversions ?? 0) + 1,
        revenue_cents: (pw.revenue_cents ?? 0) + amount,
      }).eq("id", hatchPaywallId)
    }
  }

  await supabase.from("events").insert({
    account_id: accountId,
    paywall_id: hatchPaywallId || null,
    event_type: "payment_success",
    user_id_external: hatchUserId,
    properties: { amount_cents: amount, customer_email: session.customer_email, plan_id: hatchPlanId },
  })

  const { data: accountUser } = await supabase
    .from("users")
    .select("email, full_name")
    .eq("account_id", accountId)
    .eq("role", "owner")
    .single()

  const { data: plan } = await supabase.from("plans").select("name").eq("id", hatchPlanId).single()

  if (accountUser?.email && session.customer_email) {
    await sendNewSubscriberEmail(accountUser.email, accountUser.full_name ?? "", session.customer_email, plan?.name ?? "Plan", amount)
  }
}

async function handleSubscriptionChange(supabase: SupabaseClient, sub: any, stripeAccountId?: string) {
  const statusMap: Record<string, string> = {
    active: "active", trialing: "trialing", past_due: "past_due", canceled: "canceled",
  }
  const status = statusMap[sub.status] ?? "churned"

  await supabase
    .from("subscriptions")
    .update({ status, canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null })
    .eq("stripe_subscription_id", sub.id)

  await supabase.from("subscribers").update({ subscription_status: status }).eq("stripe_customer_id", sub.customer)

  if (sub.status === "canceled" && stripeAccountId) {
    const { data: conn } = await supabase.from("stripe_connections").select("account_id").eq("stripe_account_id", stripeAccountId).single()
    if (conn) {
      await supabase.from("events").insert({
        account_id: conn.account_id,
        event_type: "subscription_canceled",
        properties: { stripe_subscription_id: sub.id },
      })
    }
  }
}

async function handlePaymentFailed(supabase: SupabaseClient, invoice: any, stripeAccountId?: string) {
  await supabase.from("subscribers").update({ subscription_status: "past_due" }).eq("stripe_customer_id", invoice.customer)

  if (stripeAccountId) {
    const { data: conn } = await supabase.from("stripe_connections").select("account_id").eq("stripe_account_id", stripeAccountId).single()
    if (conn) {
      await supabase.from("events").insert({
        account_id: conn.account_id,
        event_type: "payment_failed",
        properties: { stripe_customer_id: invoice.customer, amount: invoice.amount_due },
      })
    }
  }
}

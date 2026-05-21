import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  // Stripe returned an error
  if (error) {
    console.error("[stripe/callback] Stripe error:", error, errorDescription)
    return NextResponse.redirect(`${origin}/settings?stripe_error=${encodeURIComponent(error)}`)
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get("stripe_oauth_state")?.value

  // CSRF state check
  if (!state || !storedState || state !== storedState) {
    console.error("[stripe/callback] State mismatch — got:", state, "stored:", storedState)
    return NextResponse.redirect(`${origin}/settings?stripe_error=invalid_state`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/settings?stripe_error=no_code`)
  }

  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const { data: profile } = await supabase
    .from("users")
    .select("account_id")
    .eq("id", user.id)
    .single()

  if (!profile?.account_id) {
    return NextResponse.redirect(`${origin}/onboarding`)
  }

  // Exchange code for access token via Stripe REST API directly
  // (stripe.oauth.token() is deprecated/removed in stripe-node v13+)
  let stripeAccountId: string
  let accessToken: string
  let refreshToken: string | undefined
  let stripeEmail: string
  let livemode: boolean

  try {
    const tokenRes = await fetch("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
      }).toString(),
    })

    const tokenData = await tokenRes.json()

    if (!tokenRes.ok || tokenData.error) {
      console.error("[stripe/callback] Token exchange failed:", tokenData)
      return NextResponse.redirect(
        `${origin}/settings?stripe_error=${encodeURIComponent(tokenData.error_description ?? tokenData.error ?? "token_exchange_failed")}`
      )
    }

    stripeAccountId = tokenData.stripe_user_id
    accessToken = tokenData.access_token
    refreshToken = tokenData.refresh_token
    stripeEmail = tokenData.stripe_publishable_key ? "" : ""
    livemode = tokenData.livemode ?? false

    // Fetch connected account details to get the email
    const accountRes = await fetch(`https://api.stripe.com/v1/accounts/${stripeAccountId}`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    })
    const accountData = await accountRes.json()
    stripeEmail = accountData.email ?? accountData.business_profile?.name ?? stripeAccountId

  } catch (err) {
    console.error("[stripe/callback] Unexpected error during token exchange:", err)
    return NextResponse.redirect(`${origin}/settings?stripe_error=server_error`)
  }

  // Save to DB — check-then-insert/update (account_id has no unique constraint)
  const payload = {
    account_id: profile.account_id,
    stripe_account_id: stripeAccountId,
    stripe_email: stripeEmail,
    access_token: accessToken,
    refresh_token: refreshToken ?? null,
    livemode,
  }

  const { data: existing } = await supabase
    .from("stripe_connections")
    .select("id")
    .eq("account_id", profile.account_id)
    .maybeSingle()

  let dbError
  if (existing) {
    const { error } = await supabase
      .from("stripe_connections")
      .update(payload)
      .eq("account_id", profile.account_id)
    dbError = error
  } else {
    const { error } = await supabase
      .from("stripe_connections")
      .insert(payload)
    dbError = error
  }

  if (dbError) {
    console.error("[stripe/callback] DB save error:", dbError)
    return NextResponse.redirect(`${origin}/settings?stripe_error=db_error`)
  }

  // Redirect back to where the user came from
  const connectOrigin = cookieStore.get("stripe_connect_origin")?.value
  const redirectPath = connectOrigin === "onboarding"
    ? `/onboarding?stripe_connected=true&stripe_email=${encodeURIComponent(stripeEmail)}`
    : `/settings?stripe_connected=true`

  const response = NextResponse.redirect(`${origin}${redirectPath}`)
  response.cookies.delete("stripe_oauth_state")
  response.cookies.delete("stripe_connect_origin")
  return response
}

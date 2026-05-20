import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getStripe } from "@/lib/stripe"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  if (error) {
    return NextResponse.redirect(`${origin}/settings?stripe_error=${error}`)
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get("stripe_oauth_state")?.value
  if (!state || state !== storedState) {
    return NextResponse.redirect(`${origin}/settings?stripe_error=invalid_state`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/settings?stripe_error=no_code`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
  if (!profile) return NextResponse.redirect(`${origin}/onboarding`)

  // Exchange code for access token
  const stripe = getStripe()
  const oauthResponse = await stripe.oauth.token({ grant_type: "authorization_code", code })

  // Upsert stripe connection
  await supabase.from("stripe_connections").upsert({
    account_id: profile.account_id,
    stripe_account_id: oauthResponse.stripe_user_id!,
    stripe_email: (oauthResponse as unknown as { stripe_publishable_key?: string; stripe_user_id?: string; scope?: string; livemode?: boolean; token_type?: string; access_token?: string; refresh_token?: string; email?: string })?.email ?? "",
    access_token: oauthResponse.access_token!,
    refresh_token: oauthResponse.refresh_token,
    livemode: oauthResponse.livemode ?? false,
  }, { onConflict: "account_id" })

  const response = NextResponse.redirect(`${origin}/settings?stripe_connected=true`)
  response.cookies.delete("stripe_oauth_state")
  return response
}

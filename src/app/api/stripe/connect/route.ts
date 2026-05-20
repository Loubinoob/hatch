import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getStripeConnectUrl } from "@/lib/stripe"
import crypto from "crypto"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const state = crypto.randomBytes(16).toString("hex")
  // Store state in session cookie for CSRF protection
  const response = NextResponse.redirect(getStripeConnectUrl(user.id, state))
  response.cookies.set("stripe_oauth_state", state, { httpOnly: true, maxAge: 600, sameSite: "lax" })
  return response
}

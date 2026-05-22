import { createClient as createSb } from "@supabase/supabase-js"

/**
 * Service-role Supabase client — bypasses RLS, for use in API routes
 * that are called from external domains (SDK endpoints) without a user session.
 */
export function createServiceClient() {
  return createSb(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

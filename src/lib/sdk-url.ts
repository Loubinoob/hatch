/**
 * Returns the absolute URL of the SDK script for use in install snippets.
 * Uses NEXT_PUBLIC_APP_URL (inlined at build time) on the server,
 * and window.location.origin as a safe fallback on the client.
 *
 * IMPORTANT: If your dashboard runs on a different origin than your app
 * (e.g. localhost vs prod), always set NEXT_PUBLIC_APP_URL so the snippet
 * points to production and not localhost.
 */
export function getSdkScriptUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (base) return `${base}/sdk/sdk.js`
  if (typeof window !== "undefined") return window.location.origin + "/sdk/sdk.js"
  return "/sdk/sdk.js"
}

/**
 * Returns the base app URL (no trailing slash).
 */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? (
    typeof window !== "undefined" ? window.location.origin : ""
  )
}

/**
 * Returns the absolute URL of the SDK script for use in install snippets.
 * Always uses NEXT_PUBLIC_APP_URL (inlined at build time) so snippets always
 * point to production, even when the dashboard is running locally.
 */
export function getSdkScriptUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? ""
  if (!base) {
    console.warn("[Hatch] NEXT_PUBLIC_APP_URL is not set — SDK snippet URL will be invalid")
  }
  return base ? `${base}/sdk/sdk.js` : "/sdk/sdk.js"
}

/**
 * Returns the base app URL (no trailing slash).
 */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? ""
}

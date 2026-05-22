/**
 * Returns the URL of the SDK script for use in install snippets.
 * On the server, reads NEXT_PUBLIC_APP_URL.
 * On the client, derives from window.location.origin (works on any deployment).
 */
export function getSdkScriptUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin + "/sdk/sdk.js"
  }
  const base = process.env.NEXT_PUBLIC_APP_URL ?? ""
  return base ? `${base}/sdk/sdk.js` : "/sdk/sdk.js"
}

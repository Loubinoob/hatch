import { Resend } from "resend"

function getResend() {
  return new Resend(process.env.RESEND_API_KEY ?? "re_placeholder")
}

export async function sendWelcomeEmail(email: string, name: string) {
  return getResend().emails.send({
    from: "Hatch <hello@hatch.io>",
    to: email,
    subject: "Welcome to Hatch — your paywall is ready",
    html: `
      <div style="font-family:Inter,sans-serif;background:#0A0A0B;color:#F4F4F5;padding:40px;max-width:560px;margin:0 auto;border-radius:12px">
        <div style="margin-bottom:32px">
          <span style="font-size:24px;font-weight:700;background:linear-gradient(135deg,#6366F1,#8B5CF6);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Hatch</span>
        </div>
        <h1 style="font-size:28px;font-weight:700;margin:0 0 12px">Welcome, ${name}!</h1>
        <p style="color:#A1A1AA;line-height:1.6;margin:0 0 24px">
          Your account is ready. Connect your Stripe account and drop one line of code to start monetizing.
        </p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/onboarding" style="display:inline-block;background:#6366F1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Complete setup →
        </a>
        <p style="color:#52525B;font-size:12px;margin-top:40px">Hatch · Made for vibe coders</p>
      </div>
    `,
  })
}

export async function sendNewSubscriberEmail(
  founderEmail: string,
  founderName: string,
  subscriberEmail: string,
  planName: string,
  amount: number
) {
  return getResend().emails.send({
    from: "Hatch <notifications@hatch.io>",
    to: founderEmail,
    subject: `New subscriber — ${subscriberEmail} just upgraded to ${planName}`,
    html: `
      <div style="font-family:Inter,sans-serif;background:#0A0A0B;color:#F4F4F5;padding:40px;max-width:560px;margin:0 auto;border-radius:12px">
        <div style="margin-bottom:32px">
          <span style="font-size:24px;font-weight:700;background:linear-gradient(135deg,#6366F1,#8B5CF6);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Hatch</span>
        </div>
        <h1 style="font-size:24px;font-weight:700;margin:0 0 8px">New subscriber 🎉</h1>
        <p style="color:#A1A1AA;margin:0 0 24px">${subscriberEmail} just subscribed to <strong style="color:#F4F4F5">${planName}</strong> at <strong style="color:#6366F1">$${(amount / 100).toFixed(2)}/mo</strong>.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="display:inline-block;background:#111114;border:1px solid rgba(255,255,255,0.06);color:#F4F4F5;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          View dashboard →
        </a>
        <p style="color:#52525B;font-size:12px;margin-top:40px">Hatch is charging a 1% fee on this subscription.</p>
      </div>
    `,
  })
}

export async function sendTrialExpiringEmail(
  userEmail: string,
  appName: string,
  daysLeft: number,
  paywallUrl: string
) {
  return getResend().emails.send({
    from: `${appName} <notifications@hatch.io>`,
    to: userEmail,
    subject: daysLeft === 0 ? `Your free trial has ended` : `Your trial ends in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`,
    html: `
      <div style="font-family:Inter,sans-serif;background:#0A0A0B;color:#F4F4F5;padding:40px;max-width:560px;margin:0 auto;border-radius:12px">
        <h1 style="font-size:24px;font-weight:700;margin:0 0 12px">
          ${daysLeft === 0 ? "Your trial has ended" : `${daysLeft} day${daysLeft > 1 ? "s" : ""} left on your trial`}
        </h1>
        <p style="color:#A1A1AA;line-height:1.6;margin:0 0 24px">
          ${daysLeft === 0
            ? `Your free trial of ${appName} has ended. Upgrade now to keep access.`
            : `You have ${daysLeft} day${daysLeft > 1 ? "s" : ""} left on your free trial of ${appName}.`
          }
        </p>
        <a href="${paywallUrl}" style="display:inline-block;background:#6366F1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Upgrade now →
        </a>
      </div>
    `,
  })
}

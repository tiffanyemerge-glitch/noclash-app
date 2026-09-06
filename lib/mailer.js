// Sends Contact Us submissions by email via the Resend HTTP API (https://resend.com).
// Render's outbound network blocks direct SMTP connections — confirmed by testing both
// port 465 and port 587 to Gmail, which both hang until connection timeout — so email is
// sent over plain HTTPS instead, which isn't blocked. Falls back to a clearly-labeled demo
// mode — just logs to the server console — whenever RESEND_API_KEY isn't set, so the app
// still works end-to-end without a real key configured.

function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

async function sendContactMessage({ name, email, phone, message }) {
  const to = process.env.CONTACT_TO_EMAIL || process.env.GMAIL_USER;
  // Resend's shared "onboarding@resend.dev" sender works without verifying a domain, but can
  // only deliver to the email address the Resend account itself was signed up with. Once a
  // custom domain is verified in Resend, set CONTACT_FROM_EMAIL to send from that instead.
  const from = process.env.CONTACT_FROM_EMAIL || 'NoClash Contact Form <onboarding@resend.dev>';

  if (!isConfigured()) {
    console.log('[contact] demo mode (RESEND_API_KEY not set) — would have emailed', to, {
      name,
      email,
      phone,
      message
    });
    return { demo: true };
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to,
      reply_to: email,
      subject: `NoClash contact form — ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || '(not provided)'}\n\n${message || '(no message)'}`
    })
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Resend API error ${resp.status}: ${body}`);
  }

  return resp.json();
}

module.exports = { isConfigured, sendContactMessage };

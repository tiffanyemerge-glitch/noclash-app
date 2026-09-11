// Sends Contact Us submissions and password-reset links by email via the Resend HTTP API
// (https://resend.com). Render's outbound network blocks direct SMTP connections — confirmed by
// testing both port 465 and port 587 to Gmail, which both hang until connection timeout — so
// email is sent over plain HTTPS instead, which isn't blocked. Falls back to a clearly-labeled
// demo mode — just logs to the server console — whenever RESEND_API_KEY isn't set, so the app
// still works end-to-end without a real key configured.
//
// NOTE: Resend's shared "onboarding@resend.dev" sender can only deliver to the email address the
// Resend account itself was signed up with. That's fine for the contact form (it always goes to
// one fixed inbox), but password-reset emails need to reach ANY user's address — that only works
// once a real domain is verified in Resend and CONTACT_FROM_EMAIL is set to an address on it.
// Until then, reset emails to anyone other than the Resend account's own inbox will fail to send
// (the failure is logged, not silent) — see routes/auth.js.

function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

async function sendViaResend({ to, subject, text, replyTo }) {
  const from = process.env.CONTACT_FROM_EMAIL || 'NoClash <onboarding@resend.dev>';

  if (!isConfigured()) {
    console.log('[mailer] demo mode (RESEND_API_KEY not set) — would have emailed', to, { subject, text });
    return { demo: true };
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to, subject, text, ...(replyTo ? { reply_to: replyTo } : {}) })
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Resend API error ${resp.status}: ${body}`);
  }

  return resp.json();
}

async function sendContactMessage({ name, email, phone, message }) {
  const to = process.env.CONTACT_TO_EMAIL || process.env.GMAIL_USER;
  return sendViaResend({
    to,
    subject: `NoClash contact form — ${name}`,
    text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || '(not provided)'}\n\n${message || '(no message)'}`,
    replyTo: email
  });
}

async function sendPasswordReset({ to, resetUrl }) {
  return sendViaResend({
    to,
    subject: 'Reset your NoClash password',
    text: `Someone requested a password reset for your NoClash account.\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email — your password won't change.`
  });
}

async function sendAmbassadorApplicationReceived({ name, email }) {
  const to = process.env.CONTACT_TO_EMAIL || process.env.GMAIL_USER;
  if (!to) return { skipped: true }; // nowhere configured to send admin notices — the application still saves either way
  return sendViaResend({
    to,
    subject: `New ambassador application — ${name}`,
    text: `${name} (${email}) applied to the NoClash Ambassador Program. Review it at /admin.`,
    replyTo: email
  });
}

async function sendAmbassadorApproved({ to, name, code }) {
  return sendViaResend({
    to,
    subject: "You're approved — your NoClash ambassador code",
    text: `Hi ${name},\n\nYou're in! Your NoClash referral code is: ${code}\n\nShare it with your audience, or send people to noclashcalendar.com/signup?ref=${code} — anyone who signs up with your code and buys an Organizer Pass ($49) earns you a 15% commission ($7.35).\n\nTo stay active in the program, post about NoClash at least twice a month.\n\nThanks for helping spread the word!`
  });
}

module.exports = {
  isConfigured,
  sendContactMessage,
  sendPasswordReset,
  sendAmbassadorApplicationReceived,
  sendAmbassadorApproved
};

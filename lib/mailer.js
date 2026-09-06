// Sends Contact Us submissions by email via Gmail SMTP (using a Gmail App Password, not the
// real account password). Falls back to a clearly-labeled demo mode — just logs to the server
// console — whenever GMAIL_USER / GMAIL_APP_PASSWORD aren't set, so the app still works
// end-to-end without real credentials configured.

function isConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

let _transporter = null;
function transporter() {
  if (!_transporter) {
    const nodemailer = require('nodemailer');
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        // App Passwords are shown as 4 groups of 4 letters ("abcd efgh ijkl mnop") — strip any
        // spaces in case one was pasted into the env var that way.
        pass: String(process.env.GMAIL_APP_PASSWORD).replace(/\s+/g, '')
      }
    });
  }
  return _transporter;
}

async function sendContactMessage({ name, email, phone, message }) {
  const to = process.env.CONTACT_TO_EMAIL || process.env.GMAIL_USER;

  if (!isConfigured()) {
    console.log('[contact] demo mode (GMAIL_USER / GMAIL_APP_PASSWORD not set) — would have emailed', to, {
      name,
      email,
      phone,
      message
    });
    return { demo: true };
  }

  return transporter().sendMail({
    from: `"NoClash Contact Form" <${process.env.GMAIL_USER}>`,
    to,
    replyTo: email,
    subject: `NoClash contact form — ${name}`,
    text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || '(not provided)'}\n\n${message || '(no message)'}`
  });
}

module.exports = { isConfigured, sendContactMessage };

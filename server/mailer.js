import { BrevoClient } from '@getbrevo/brevo';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'emails');
const templateCache = new Map();

// Templates live as plain .html/.txt files in server/emails/ so the copy is
// editable (and previewable in a browser) without touching this file.
// Placeholders are {{name}}; values are substituted verbatim.
function render(name, vars) {
  let body = templateCache.get(name);
  if (body === undefined) {
    body = readFileSync(join(TEMPLATE_DIR, name), 'utf8');
    templateCache.set(name, body);
  }
  return body.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? vars[key] : m));
}

export async function sendVerificationEmail(toEmail, verifyUrl) {
  if (!process.env.BREVO_API_KEY) {
    console.log(`[mailer] BREVO_API_KEY unset — skipping verification email to ${toEmail}. Verify link: ${verifyUrl}`);
    return;
  }
  const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
  await client.transactionalEmails.sendTransacEmail({
    sender: { name: 'ARCHITECT', email: process.env.SMTP_FROM_EMAIL },
    to: [{ email: toEmail }],
    subject: 'ARCHITECT — Verify your email',
    textContent: render('verify.txt', { verifyUrl }),
    htmlContent: render('verify.html', { verifyUrl }),
  });
}

export async function sendPasswordResetEmail(toEmail, resetUrl) {
  if (!process.env.BREVO_API_KEY) {
    console.log(`[mailer] BREVO_API_KEY unset — skipping password reset email to ${toEmail}. Reset link: ${resetUrl}`);
    return;
  }
  const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
  await client.transactionalEmails.sendTransacEmail({
    sender: { name: 'ARCHITECT', email: process.env.SMTP_FROM_EMAIL },
    to: [{ email: toEmail }],
    subject: 'ARCHITECT — Password Reset',
    textContent: render('password-reset.txt', { resetUrl }),
    htmlContent: render('password-reset.html', { resetUrl }),
  });
}

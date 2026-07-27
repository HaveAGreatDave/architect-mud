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

// Both env vars are required: without SMTP_FROM_EMAIL the sender address is
// undefined and Brevo rejects the call with a 400 — which used to look exactly
// like "the mail just never arrived". Callers check this *before* promising a
// player that a link is on the way.
export function mailerConfigProblem() {
  const missing = [];
  if (!process.env.BREVO_API_KEY) missing.push('BREVO_API_KEY');
  if (!process.env.SMTP_FROM_EMAIL) missing.push('SMTP_FROM_EMAIL');
  return missing.length ? `missing env ${missing.join(' + ')}` : null;
}

export function isMailerConfigured() { return mailerConfigProblem() === null; }

// Brevo errors carry the useful part in the response body, not in .message.
function errorDetail(e) {
  const body = e?.body ?? e?.response?.body ?? e?.response?.text;
  const status = e?.statusCode ?? e?.status ?? e?.response?.status;
  const parts = [e?.message || String(e)];
  if (status) parts.push(`status=${status}`);
  if (body) parts.push(typeof body === 'string' ? body : JSON.stringify(body));
  return parts.join(' | ');
}

async function send({ label, toEmail, subject, textTemplate, htmlTemplate, vars, link }) {
  const problem = mailerConfigProblem();
  if (problem) {
    // Loud, and still print the link so a dev can complete the flow by hand.
    console.error(`[mailer] NOT CONFIGURED (${problem}) — ${label} to ${toEmail} was NOT sent. Link: ${link}`);
    throw new Error(`Email delivery is not configured on this server (${problem}).`);
  }
  const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
  try {
    const res = await client.transactionalEmails.sendTransacEmail({
      sender: { name: 'ARCHITECT', email: process.env.SMTP_FROM_EMAIL },
      to: [{ email: toEmail }],
      subject,
      textContent: render(textTemplate, vars),
      htmlContent: render(htmlTemplate, vars),
    });
    console.log(`[mailer] ${label} sent to ${toEmail}${res?.messageId ? ` (${res.messageId})` : ''}`);
    return res;
  } catch (e) {
    console.error(`[mailer] ${label} to ${toEmail} FAILED: ${errorDetail(e)}`);
    throw new Error(`Mail provider rejected the ${label}.`);
  }
}

export function sendVerificationEmail(toEmail, verifyUrl) {
  return send({
    label: 'verification email',
    toEmail,
    subject: 'ARCHITECT — Verify your email',
    textTemplate: 'verify.txt',
    htmlTemplate: 'verify.html',
    vars: { verifyUrl },
    link: verifyUrl,
  });
}

export function sendPasswordResetEmail(toEmail, resetUrl) {
  return send({
    label: 'password reset email',
    toEmail,
    subject: 'ARCHITECT — Password Reset',
    textTemplate: 'password-reset.txt',
    htmlTemplate: 'password-reset.html',
    vars: { resetUrl },
    link: resetUrl,
  });
}

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
  if (missing.length) return `missing env ${missing.join(' + ')}`;
  // Set-but-malformed used to sail past this check and come back from Brevo as
  // a 400 "valid sender email required" — a provider error for what is really a
  // dashboard typo. Catch the shapes a paste actually produces: wrapping quotes,
  // `Name <addr>` display form, stray whitespace.
  const from = senderEmail();
  if (!/^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(from)) {
    return `SMTP_FROM_EMAIL is not a bare email address (got "${process.env.SMTP_FROM_EMAIL}")`;
  }
  return null;
}

// Trimmed, and tolerant of a value that arrived wrapped in quotes — Render
// stores those literally, and Brevo rejects them.
export function mailerSender() { return senderEmail(); }

function senderEmail() {
  return (process.env.SMTP_FROM_EMAIL || '').trim().replace(/^["']|["']$/g, '');
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
  // Rendered *outside* the try: a missing/unreadable template is a filesystem
  // problem on this server, and blaming the mail provider for it sends whoever
  // reads the error off hunting through the Brevo dashboard for nothing.
  let textContent, htmlContent;
  try {
    textContent = render(textTemplate, vars);
    htmlContent = render(htmlTemplate, vars);
  } catch (e) {
    console.error(`[mailer] ${label} to ${toEmail} FAILED to render (${textTemplate}/${htmlTemplate}): ${e.message}. Link: ${link}`);
    throw new Error(`Email template could not be loaded on this server.`);
  }
  const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
  try {
    const res = await client.transactionalEmails.sendTransacEmail({
      sender: { name: 'ARCHITECT', email: senderEmail() },
      to: [{ email: toEmail }],
      subject,
      textContent,
      htmlContent,
    });
    console.log(`[mailer] ${label} sent to ${toEmail}${res?.messageId ? ` (${res.messageId})` : ''}`);
    return res;
  } catch (e) {
    console.error(`[mailer] ${label} to ${toEmail} FAILED: ${errorDetail(e)}`);
    // The status code alone narrows it enough to act on (401 key, 400 sender or
    // blocked recipient, 402 credits) without leaking the provider's body text
    // to a player. The full detail is on the line above, in the server log.
    const status = e?.statusCode ?? e?.status ?? e?.response?.status;
    throw new Error(`Mail provider rejected the ${label}${status ? ` (error ${status})` : ''}.`);
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

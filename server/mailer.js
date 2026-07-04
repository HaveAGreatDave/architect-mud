import { BrevoClient } from '@getbrevo/brevo';

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
    textContent: `Verify your ARCHITECT account (link expires in 24 hours):\n${verifyUrl}\n\nIf you didn't register, ignore this email.`,
    htmlContent: `<p>Welcome to ARCHITECT.</p><p><a href="${verifyUrl}">Verify your email address</a> (expires in 24 hours)</p><p>If you didn't register, ignore this email.</p>`,
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
    textContent: `Reset link (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
    htmlContent: `<p>You requested a password reset for your ARCHITECT account.</p><p><a href="${resetUrl}">Reset your password</a> (expires in 1 hour)</p><p>If you didn't request this, ignore this email.</p>`,
  });
}

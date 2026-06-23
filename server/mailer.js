import { BrevoClient } from '@getbrevo/brevo';

export async function sendPasswordResetEmail(toEmail, resetUrl) {
  const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
  await client.transactionalEmails.sendTransacEmail({
    sender: { name: 'ARCHITECT', email: process.env.SMTP_FROM_EMAIL },
    to: [{ email: toEmail }],
    subject: 'ARCHITECT — Password Reset',
    textContent: `Reset link (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
    htmlContent: `<p>You requested a password reset for your ARCHITECT account.</p><p><a href="${resetUrl}">Reset your password</a> (expires in 1 hour)</p><p>If you didn't request this, ignore this email.</p>`,
  });
}

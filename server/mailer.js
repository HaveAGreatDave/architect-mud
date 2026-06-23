import nodemailer from 'nodemailer';

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

export async function sendPasswordResetEmail(toEmail, resetUrl) {
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'ARCHITECT — Password Reset',
    text: `Reset link (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
    html: `<p>You requested a password reset for your ARCHITECT account.</p><p><a href="${resetUrl}">Reset your password</a> (expires in 1 hour)</p><p>If you didn't request this, ignore this email.</p>`,
  });
}

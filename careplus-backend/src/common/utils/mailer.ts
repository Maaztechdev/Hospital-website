import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@config/env";
import { logger } from "@config/logger";

let transporter: Transporter | null = null;

export function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT);
}

export function setTransporterForTesting(custom: Transporter | null): void {
  transporter = custom;
}

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!isSmtpConfigured()) return null;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          }
        : undefined,
  });
  return transporter;
}

export interface SendPasswordResetResult {
  sent: boolean;
  deliveryMethod: "smtp" | "logged_dev";
  resetUrl: string;
}

export async function sendPasswordResetEmail(
  toEmail: string,
  resetToken: string,
  recipientName?: string
): Promise<SendPasswordResetResult> {
  const resetUrl = `${env.FRONTEND_URL}/dashboard/reset-password?token=${encodeURIComponent(resetToken)}`;
  const greeting = recipientName ? `Hello ${recipientName},` : "Hello,";

  const subject = "Password Reset Request — Khalida Medicare Hospital";
  const textContent = `${greeting}

We received a request to reset the password for your Khalida Medicare Hospital account (${toEmail}).

To set a new password, open the link below in your browser:
${resetUrl}

This link is valid for ${env.PASSWORD_RESET_EXPIRES_IN} and can only be used once.

If you did not request this password reset, please ignore this email or notify your system administrator immediately.

—
Khalida Medicare Hospital
Security & Administration Team`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background: #0284c7; padding: 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.025em; }
    .header p { margin: 4px 0 0; font-size: 13px; opacity: 0.9; }
    .body { padding: 32px 28px; }
    .body p { font-size: 14px; line-height: 1.6; margin: 0 0 16px; color: #334155; }
    .btn-wrap { text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background: #0284c7; color: #ffffff !important; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; }
    .callout { background: #f8fafc; border-left: 4px solid #0284c7; padding: 12px 16px; border-radius: 4px; font-size: 13px; color: #475569; margin: 20px 0; }
    .footer { background: #f8fafc; padding: 16px 28px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Khalida Medicare Hospital</h1>
      <p>Staff &amp; Clinical Management Portal</p>
    </div>
    <div class="body">
      <p>${greeting}</p>
      <p>A request was received to reset the password for your account associated with <strong>${toEmail}</strong>.</p>
      <div class="btn-wrap">
        <a href="${resetUrl}" class="btn" target="_blank" rel="noopener noreferrer">Reset Your Password</a>
      </div>
      <div class="callout">
        <strong>Security Notice:</strong> This link is time-limited (${env.PASSWORD_RESET_EXPIRES_IN}) and single-use. Once used, it will automatically expire.
      </div>
      <p style="font-size: 12px; color: #64748b;">If the button above does not work, copy and paste this URL into your browser:<br><a href="${resetUrl}" style="color: #0284c7; word-break: break-all;">${resetUrl}</a></p>
      <p style="font-size: 13px; color: #64748b; margin-top: 24px;">If you did not request this password change, no action is required; your account remains secure.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Khalida Medicare Hospital. All rights reserved.
    </div>
  </div>
</body>
</html>
`;

  const mailTransport = getTransporter();

  if (mailTransport) {
    try {
      await mailTransport.sendMail({
        from: env.SMTP_FROM,
        to: toEmail,
        subject,
        text: textContent,
        html: htmlContent,
      });
      logger.info({ to: toEmail }, "Password reset email dispatched via SMTP successfully");
      return { sent: true, deliveryMethod: "smtp", resetUrl };
    } catch (error) {
      logger.error({ error, to: toEmail }, "Failed to send password reset email via SMTP");
      // Fall through to return delivery status
      return { sent: false, deliveryMethod: "smtp", resetUrl };
    }
  } else {
    if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
      logger.info(
        { to: toEmail, resetUrl },
        "[MAILER NOTICE] SMTP is not configured. Reset link generated for local/dev use."
      );
    } else {
      logger.warn("SMTP not configured, reset email not sent");
    }
    return { sent: true, deliveryMethod: "logged_dev", resetUrl };
  }
}

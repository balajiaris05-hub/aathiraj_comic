import nodemailer from 'nodemailer';

export interface SmtpConfigSummary {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
}

export interface EmailSendResult {
  sent: boolean;
  configured: boolean;
  messageId?: string;
  accepted?: string[];
  error?: string;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSmtpSettings() {
  const host = (process.env.SMTP_HOST || '').trim();
  const portRaw = Number((process.env.SMTP_PORT || '465').trim());
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 465;
  const rawSecure = (process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure = port === 465 ? true : rawSecure === 'true';
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const fromEmail = (process.env.SMTP_FROM || user || 'aathiraicomic@gmail.com').trim();
  const configured = Boolean(host && user && pass);

  return { host, port, secure, user, pass, fromEmail, configured };
}

export function getSmtpConfigSummary(): SmtpConfigSummary {
  const { configured, host, port, secure, user, fromEmail } = getSmtpSettings();
  return {
    configured,
    host: host || 'unconfigured',
    port,
    secure,
    user: user || '',
    from: fromEmail,
  };
}

function createTransporter() {
  const { host, port, secure, user, pass, configured } = getSmtpSettings();
  if (!configured) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

export async function verifySmtpConnection(): Promise<{
  ok: boolean;
  configured: boolean;
  summary: SmtpConfigSummary;
  error?: string;
}> {
  const summary = getSmtpConfigSummary();
  const transporter = createTransporter();
  if (!transporter) {
    return {
      ok: false,
      configured: false,
      summary,
      error: 'SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) are not configured.',
    };
  }

  try {
    await transporter.verify();
    return {
      ok: true,
      configured: true,
      summary,
    };
  } catch (err: any) {
    return {
      ok: false,
      configured: true,
      summary,
      error: err?.message || 'SMTP verification failed.',
    };
  }
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailSendResult> {
  const settings = getSmtpSettings();
  const transporter = createTransporter();
  if (!transporter) {
    return {
      sent: false,
      configured: false,
      error: 'SMTP credentials are not configured.',
    };
  }

  try {
    const info = await transporter.sendMail({
      from: `"Aathirai_Comic" <${settings.fromEmail}>`,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });

    return {
      sent: true,
      configured: true,
      messageId: info.messageId,
      accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : undefined,
    };
  } catch (err: any) {
    console.error('[Aathirai_Comic SMTP] Failed to send email:', err?.message || err);
    return {
      sent: false,
      configured: true,
      error: err?.message || 'Failed to send email via SMTP.',
    };
  }
}

export async function sendAdminOtpEmail(to: string, otp: string): Promise<EmailSendResult> {
  const safeOtp = escapeHtml(otp);
  return sendEmail({
    to,
    subject: 'Aathirai_Comic Admin 2FA Verification Code',
    text: `Your Aathirai_Comic Administrator 2FA OTP is: ${otp}\n\nThis code is valid for 10 minutes. Do not share this code with anyone.`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0f172a;color:#f1f5f9;border-radius:12px;border:1px solid #334155;">
        <h2 style="margin:0 0 12px;color:#fb7185;">Aathirai_Comic Admin Security</h2>
        <p style="margin:0 0 16px;color:#cbd5e1;font-size:14px;">Use this one-time 6-digit verification code to unlock the Administrator Console:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;padding:14px 18px;background:#1e293b;border-radius:8px;text-align:center;color:#ffffff;margin-bottom:16px;">${safeOtp}</div>
        <p style="margin:0;color:#94a3b8;font-size:12px;">Valid for 10 minutes. If you did not request this code, ignore this email.</p>
      </div>
    `,
  });
}

export async function sendReaderWelcomeAndOtpEmail(params: {
  to: string;
  name: string;
  otp: string;
}): Promise<EmailSendResult> {
  const safeName = escapeHtml(params.name);
  const safeOtp = escapeHtml(params.otp);
  return sendEmail({
    to: params.to,
    subject: 'Welcome to Aathirai_Comic! Verify Your Account OTP',
    text: `Hello ${params.name},\n\nWelcome to Aathirai_Comic! Your verification OTP code is: ${params.otp}\n\nThis code is valid for 10 minutes. Enter it on the verification screen to activate your reader account.`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0f172a;color:#f1f5f9;border-radius:12px;border:1px solid #334155;">
        <h2 style="margin:0 0 12px;color:#fb7185;">Welcome to Aathirai_Comic!</h2>
        <p style="margin:0 0 12px;color:#cbd5e1;font-size:14px;">Hello <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 16px;color:#cbd5e1;font-size:14px;">Your customer account has been created. Enter this 6-digit verification OTP to activate your account:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;padding:14px 18px;background:#1e293b;border-radius:8px;text-align:center;color:#ffffff;margin-bottom:16px;">${safeOtp}</div>
        <p style="margin:0;color:#94a3b8;font-size:12px;">Valid for 10 minutes. Explore Tamil, Indian & general comics on Aathirai_Comic.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetOtpEmail(params: {
  to: string;
  name: string;
  otp: string;
}): Promise<EmailSendResult> {
  const safeName = escapeHtml(params.name);
  const safeOtp = escapeHtml(params.otp);
  return sendEmail({
    to: params.to,
    subject: 'Aathirai_Comic Password Reset OTP Code',
    text: `Hello ${params.name},\n\nYour password reset verification OTP is: ${params.otp}\n\nThis code expires in 10 minutes. If you did not request a password reset, please ignore this email.`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0f172a;color:#f1f5f9;border-radius:12px;border:1px solid #334155;">
        <h2 style="margin:0 0 12px;color:#fb7185;">Aathirai_Comic Password Recovery</h2>
        <p style="margin:0 0 12px;color:#cbd5e1;font-size:14px;">Hello <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 16px;color:#cbd5e1;font-size:14px;">Use this 6-digit OTP to verify your identity and set a new password:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;padding:14px 18px;background:#1e293b;border-radius:8px;text-align:center;color:#ffffff;margin-bottom:16px;">${safeOtp}</div>
        <p style="margin:0;color:#94a3b8;font-size:12px;">Valid for 10 minutes. Your account lock will clear once the reset completes.</p>
      </div>
    `,
  });
}

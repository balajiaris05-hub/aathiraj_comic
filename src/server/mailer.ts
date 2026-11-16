import crypto from 'crypto';
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
  from?: string;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
  response?: string;
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

function createTransporter(override?: { port?: number; secure?: boolean }) {
  const { host, port: defaultPort, secure: defaultSecure, user, pass, configured } = getSmtpSettings();
  if (!configured) {
    return null;
  }

  const port = override?.port ?? defaultPort;
  const secure = override?.secure ?? defaultSecure;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user,
      pass,
    },
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 18000,
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
  const primaryTransporter = createTransporter();
  if (!primaryTransporter) {
    return {
      sent: false,
      configured: false,
      from: settings.fromEmail,
      error: 'SMTP credentials are not configured.',
    };
  }

  const entityRef = crypto.randomUUID();
  const mailOptions = {
    from: `"Aathirai_Comic" <${settings.fromEmail}>`,
    replyTo: settings.fromEmail,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    headers: {
      'X-Entity-Ref-ID': entityRef,
    },
  };

  const attemptSend = async (transporter: NonNullable<ReturnType<typeof createTransporter>>) => {
    const info = await transporter.sendMail(mailOptions);
    const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];
    return { info, accepted, rejected };
  };

  try {
    let result;
    try {
      result = await attemptSend(primaryTransporter);
    } catch (primaryErr: any) {
      const errCode = String(primaryErr?.code || '');
      const shouldRetryStartTls =
        settings.port === 465 &&
        ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ESOCKET', 'EHOSTUNREACH'].includes(errCode);
      if (!shouldRetryStartTls) {
        throw primaryErr;
      }
      console.warn(
        `[Aathirai_Comic SMTP] Primary port 465 failed (${errCode}), retrying via STARTTLS port 587...`
      );
      const fallbackTransporter = createTransporter({ port: 587, secure: false });
      if (!fallbackTransporter) {
        throw primaryErr;
      }
      result = await attemptSend(fallbackTransporter);
    }

    const { info, accepted, rejected } = result;
    const recipientLower = params.to.trim().toLowerCase();
    const isRejected =
      accepted.length === 0 ||
      rejected.some((r: string) => r.trim().toLowerCase() === recipientLower);

    if (isRejected) {
      console.error('[Aathirai_Comic SMTP] Recipient rejected by SMTP server:', {
        to: params.to,
        accepted,
        rejected,
        response: info.response,
      });
      return {
        sent: false,
        configured: true,
        from: settings.fromEmail,
        messageId: info.messageId,
        accepted,
        rejected,
        response: info.response,
        error: `Mail server rejected recipient (${params.to}). Please double-check your Gmail address.`,
      };
    }

    console.info('[Aathirai_Comic SMTP] Email accepted by SMTP relay:', {
      to: params.to,
      from: settings.fromEmail,
      messageId: info.messageId,
      accepted,
      response: info.response,
    });

    return {
      sent: true,
      configured: true,
      from: settings.fromEmail,
      messageId: info.messageId,
      accepted,
      rejected,
      response: info.response,
    };
  } catch (err: any) {
    console.error('[Aathirai_Comic SMTP] Failed to send email:', err?.message || err);
    return {
      sent: false,
      configured: true,
      from: settings.fromEmail,
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

export async function sendEmailVerificationOtpEmail(params: {
  to: string;
  name?: string;
  otp: string;
}): Promise<EmailSendResult> {
  const safeName = escapeHtml(params.name?.trim() || 'Reader');
  const safeOtp = escapeHtml(params.otp);
  const refTag = crypto.randomBytes(2).toString('hex').toUpperCase();
  return sendEmail({
    to: params.to,
    subject: `Aathirai_Comic Gmail Verification Code (Ref #${refTag})`,
    text: `Hello ${params.name?.trim() || 'Reader'},\n\nYour 6-digit Gmail verification code for Aathirai_Comic is: ${params.otp}\n\nThis code is valid for 10 minutes. Enter this code on the registration form to verify your Gmail address before creating your account.\n\nReference: #${refTag}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#ffffff;color:#0f172a;border-radius:12px;border:1px solid #e2e8f0;">
        <h2 style="margin:0 0 12px;color:#e11d48;font-size:20px;">Verify Your Gmail Address</h2>
        <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.5;">Hello <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5;">Use the 6-digit verification code below to confirm your Gmail address on Aathirai_Comic:</p>
        <div style="font-size:30px;font-weight:700;letter-spacing:6px;padding:16px 20px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;text-align:center;color:#0f172a;margin-bottom:16px;">${safeOtp}</div>
        <p style="margin:0 0 8px;color:#475569;font-size:12px;line-height:1.5;">This code is valid for 10 minutes. Do not share it with anyone.</p>
        <p style="margin:0;color:#94a3b8;font-size:11px;">Reference: #${refTag}</p>
      </div>
    `,
  });
}

export async function sendReaderAccountWelcomeEmail(params: {
  to: string;
  name: string;
}): Promise<EmailSendResult> {
  const safeName = escapeHtml(params.name);
  return sendEmail({
    to: params.to,
    subject: 'Welcome to Aathirai_Comic! Your Customer Account is Active',
    text: `Hello ${params.name},\n\nWelcome to Aathirai_Comic! Your Gmail and Mobile Number have been verified and your customer account is now active.\n\nExplore Tamil, Indian & general comics anytime.`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0f172a;color:#f1f5f9;border-radius:12px;border:1px solid #334155;">
        <h2 style="margin:0 0 12px;color:#fb7185;">Welcome to Aathirai_Comic!</h2>
        <p style="margin:0 0 12px;color:#cbd5e1;font-size:14px;">Hello <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 12px;color:#cbd5e1;font-size:14px;">Your Gmail address and Mobile Number have been verified and your customer account is now active.</p>
        <p style="margin:0;color:#94a3b8;font-size:12px;">Explore Tamil, Indian &amp; general comics on Aathirai_Comic.</p>
      </div>
    `,
  });
}

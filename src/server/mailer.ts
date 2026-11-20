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

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
  suppressRecipientLog?: boolean;
  attachments?: EmailAttachment[];
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
    ...(Array.isArray(params.attachments) && params.attachments.length > 0
      ? { attachments: params.attachments }
      : {}),
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
      if (params.suppressRecipientLog) {
        console.error('[Aathirai_Comic SMTP] Protected security recipient rejected by SMTP server.');
      } else {
        console.error('[Aathirai_Comic SMTP] Recipient rejected by SMTP server:', {
          to: params.to,
          accepted,
          rejected,
          response: info.response,
        });
      }
      return {
        sent: false,
        configured: true,
        from: settings.fromEmail,
        messageId: info.messageId,
        accepted,
        rejected,
        response: info.response,
        error: params.suppressRecipientLog
          ? 'Mail server rejected the protected recipient address.'
          : `Mail server rejected recipient (${params.to}). Please double-check your Gmail address.`,
      };
    }

    if (params.suppressRecipientLog) {
      console.info('[Aathirai_Comic SMTP] Protected security OTP email accepted by SMTP relay.', {
        messageId: info.messageId,
      });
    } else {
      console.info('[Aathirai_Comic SMTP] Email accepted by SMTP relay:', {
        to: params.to,
        from: settings.fromEmail,
        messageId: info.messageId,
        accepted,
        response: info.response,
      });
    }

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

export async function sendAdminOtpEmail(
  to: string,
  otp: string,
  purpose: 'admin_login' | 'customer_export' = 'admin_login'
): Promise<EmailSendResult> {
  const safeOtp = escapeHtml(otp);
  const isExport = purpose === 'customer_export';
  const subject = isExport
    ? 'Aathirai_Comic Customer Export Vault Dual-OTP Code'
    : 'Aathirai_Comic Admin Console Dual-OTP Verification Code';
  const headline = isExport
    ? 'Aathirai_Comic Customer Export Vault'
    : 'Aathirai_Comic Admin Security';
  const bodyCopy = isExport
    ? 'Use this one-time 6-digit Gmail OTP together with your Mobile SMS OTP to unlock the Customer Login Details Export Vault:'
    : 'Use this one-time 6-digit Gmail OTP together with your Mobile SMS OTP to unlock the Administrator Console:';

  return sendEmail({
    to,
    subject,
    suppressRecipientLog: true,
    text: `${headline}\n\nYour 6-digit Gmail verification OTP is: ${otp}\n\nEnter this code together with your Mobile SMS OTP. Valid for 10 minutes. Do not share this code with anyone.`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0f172a;color:#f1f5f9;border-radius:12px;border:1px solid #334155;">
        <h2 style="margin:0 0 12px;color:#fb7185;">${escapeHtml(headline)}</h2>
        <p style="margin:0 0 16px;color:#cbd5e1;font-size:14px;">${escapeHtml(bodyCopy)}</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;padding:14px 18px;background:#1e293b;border-radius:8px;text-align:center;color:#ffffff;margin-bottom:16px;">${safeOtp}</div>
        <p style="margin:0;color:#94a3b8;font-size:12px;">Valid for 10 minutes. Both Gmail OTP and Mobile SMS OTP are required. If you did not request this code, ignore this email.</p>
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

export async function sendComicReleaseNotificationEmail(params: {
  to: string;
  customerName?: string;
  comicTitle: string;
  episodeTitle?: string;
  authorName?: string;
  releaseType: 'new_comic' | 'new_episode';
  isPaywalled?: boolean;
}): Promise<EmailSendResult> {
  const customerName = params.customerName?.trim() || 'Reader';
  const comicTitle = params.comicTitle.trim();
  const episodeTitle = params.episodeTitle?.trim() || '';
  const authorName = params.authorName?.trim() || 'Aathirai_Comic Editorial';
  const safeCustomerName = escapeHtml(customerName);
  const safeComicTitle = escapeHtml(comicTitle);
  const safeEpisodeTitle = escapeHtml(episodeTitle);
  const safeAuthorName = escapeHtml(authorName);
  const accessLabel = params.isPaywalled ? 'Premium Pass (₹49 / ₹249)' : 'Free to Read';

  const subject =
    params.releaseType === 'new_comic'
      ? `New Comic Published: ${comicTitle}${episodeTitle ? ` — ${episodeTitle}` : ''} | Aathirai_Comic`
      : `New Episode Published: ${comicTitle} — ${episodeTitle || 'Latest Episode'} | Aathirai_Comic`;

  const headline =
    params.releaseType === 'new_comic'
      ? 'New Comic Published on Aathirai_Comic!'
      : 'New Episode Published on Aathirai_Comic!';

  const episodeLineText = episodeTitle ? `\nEpisode Published: ${episodeTitle}` : '';
  const text = `Hello ${customerName},\n\n${headline}\n\nComic Title: ${comicTitle}${episodeLineText}\nAuthor: ${authorName}\nAccess: ${accessLabel}\n\nOpen Aathirai_Comic now to read "${comicTitle}"${episodeTitle ? ` (${episodeTitle})` : ''}.`;

  const episodeHtmlRow = episodeTitle
    ? `<p style="margin:4px 0 0;color:#cbd5e1;font-size:14px;"><strong>Episode Published:</strong> ${safeEpisodeTitle}</p>`
    : '';

  return sendEmail({
    to: params.to,
    subject,
    text,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0f172a;color:#f1f5f9;border-radius:14px;border:1px solid #334155;">
        <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#e11d48;color:#ffffff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:12px;">
          ${params.releaseType === 'new_comic' ? 'New Comic Release' : 'New Episode Release'}
        </span>
        <h2 style="margin:0 0 12px;color:#ffffff;font-size:20px;">${escapeHtml(headline)}</h2>
        <p style="margin:0 0 16px;color:#cbd5e1;font-size:14px;">Hello <strong>${safeCustomerName}</strong>, a new release is now live on Aathirai_Comic:</p>
        <div style="padding:16px;background:#1e293b;border-radius:10px;border:1px solid #334155;margin-bottom:16px;">
          <p style="margin:0;color:#fb7185;font-size:16px;font-weight:800;">${safeComicTitle}</p>
          ${episodeHtmlRow}
          <p style="margin:6px 0 0;color:#94a3b8;font-size:12px;">By ${safeAuthorName} · ${escapeHtml(accessLabel)}</p>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:12px;">Visit Aathirai_Comic and open the Notification Bar or Books tab to start reading.</p>
      </div>
    `,
  });
}

export async function sendMonthlyActivityLogArchiveEmail(params: {
  to: string;
  monthKey: string;
  monthLabel: string;
  trigger: 'auto_month_end' | 'manual';
  totalLogs: number;
  adminActionsCount: number;
  payments49Count: number;
  payments249Count: number;
  totalRevenueInr: number;
  csvContent: string;
  jsonContent: string;
}): Promise<EmailSendResult> {
  const safeMonthLabel = escapeHtml(params.monthLabel);
  const safeMonthKey = escapeHtml(params.monthKey);
  const triggerLabel =
    params.trigger === 'manual' ? 'Manual Admin Archive' : 'Automatic Month-End Archive (IST)';

  const subject = `Aathirai_Comic Monthly Activity Logs Archive — ${params.monthLabel} (${params.totalLogs} entries)`;
  const text = [
    `Aathirai_Comic Monthly Activity Log Archive (${params.monthLabel})`,
    `Archive Trigger: ${triggerLabel}`,
    `Period Key (IST): ${params.monthKey}`,
    `Total Stored Entries: ${params.totalLogs}`,
    `Admin Panel Events: ${params.adminActionsCount}`,
    `₹49 Pass Payments: ${params.payments49Count} (₹${params.payments49Count * 49})`,
    `₹249 Pass Payments: ${params.payments249Count} (₹${params.payments249Count * 249})`,
    `Logged Premium Payment Total: ₹${params.totalRevenueInr}`,
    '',
    'Both CSV and JSON files for this month are attached.',
    'Once delivered, archived entries for this month are cleared automatically from backend storage to free up space.',
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; padding: 28px; border-radius: 16px; border: 1px solid #1e293b;">
      <div style="font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #818cf8; font-weight: 700; margin-bottom: 6px;">
        Aathirai_Comic · ${escapeHtml(triggerLabel)}
      </div>
      <h2 style="margin: 0 0 8px 0; font-size: 20px; color: #ffffff;">Monthly Activity Logs Archive — ${safeMonthLabel}</h2>
      <p style="margin: 0 0 18px 0; font-size: 13px; color: #cbd5e1; line-height: 1.6;">
        Attached are both the <strong>CSV</strong> spreadsheet and <strong>JSON</strong> archive containing all Admin Panel events and verified ₹49 / ₹249 customer payments recorded for <strong>${safeMonthLabel}</strong> (${safeMonthKey}, IST).
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 13px;">
        <tr>
          <td style="padding: 10px 12px; background: #1e293b; border: 1px solid #334155; color: #94a3b8;">Total Archived Entries</td>
          <td style="padding: 10px 12px; background: #1e293b; border: 1px solid #334155; color: #ffffff; font-weight: 700; text-align: right;">${params.totalLogs}</td>
        </tr>
        <tr>
          <td style="padding: 10px 12px; background: #0f172a; border: 1px solid #334155; color: #94a3b8;">Admin Panel Actions</td>
          <td style="padding: 10px 12px; background: #0f172a; border: 1px solid #334155; color: #f43f5e; font-weight: 700; text-align: right;">${params.adminActionsCount}</td>
        </tr>
        <tr>
          <td style="padding: 10px 12px; background: #1e293b; border: 1px solid #334155; color: #94a3b8;">₹49 Pass Payments</td>
          <td style="padding: 10px 12px; background: #1e293b; border: 1px solid #334155; color: #34d399; font-weight: 700; text-align: right;">${params.payments49Count} (₹${params.payments49Count * 49})</td>
        </tr>
        <tr>
          <td style="padding: 10px 12px; background: #0f172a; border: 1px solid #334155; color: #94a3b8;">₹249 Pass Payments</td>
          <td style="padding: 10px 12px; background: #0f172a; border: 1px solid #334155; color: #34d399; font-weight: 700; text-align: right;">${params.payments249Count} (₹${params.payments249Count * 249})</td>
        </tr>
        <tr>
          <td style="padding: 10px 12px; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; font-weight: 700;">Logged Premium Total</td>
          <td style="padding: 10px 12px; background: #1e293b; border: 1px solid #334155; color: #fbbf24; font-weight: 800; text-align: right;">₹${params.totalRevenueInr}</td>
        </tr>
      </table>
      <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
        Attachments included: <code>Aathirai_Comic_Activity_Logs_${safeMonthKey}.csv</code> and <code>Aathirai_Comic_Activity_Logs_${safeMonthKey}.json</code>.<br/>
        Backend log entries for ${safeMonthLabel} are cleared automatically after confirmed email delivery to preserve storage space.
      </p>
    </div>
  `;

  return sendEmail({
    to: params.to,
    subject,
    text,
    html,
    suppressRecipientLog: true,
    attachments: [
      {
        filename: `Aathirai_Comic_Activity_Logs_${params.monthKey}.csv`,
        content: params.csvContent,
        contentType: 'text/csv; charset=utf-8',
      },
      {
        filename: `Aathirai_Comic_Activity_Logs_${params.monthKey}.json`,
        content: params.jsonContent,
        contentType: 'application/json; charset=utf-8',
      },
    ],
  });
}


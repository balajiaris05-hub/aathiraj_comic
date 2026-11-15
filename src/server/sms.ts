export type SmsProviderName = 'fast2sms' | 'twilio' | 'textbelt' | 'none';

export interface SmsConfigSummary {
  configured: boolean;
  provider: SmsProviderName;
  supportsIndia: boolean;
  supportsGlobal: boolean;
  freeTierInfo: string;
}

export interface SmsSendResult {
  sent: boolean;
  configured: boolean;
  provider: SmsProviderName;
  messageId?: string;
  quotaRemaining?: number;
  error?: string;
}

function normalizeE164(phone: string, fallbackCountryCode = '+91'): string {
  const trimmed = String(phone || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (trimmed.startsWith('+')) {
    return `+${digits}`;
  }
  const ccDigits = String(fallbackCountryCode || '+91').replace(/\D/g, '') || '91';
  if (digits.length === 10) {
    return `+${ccDigits}${digits}`;
  }
  return `+${digits}`;
}

function extractIndian10Digits(phone: string): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return digits;
  }
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]\d{9}$/.test(digits.slice(2))) {
    return digits.slice(2);
  }
  return null;
}

function resolveSmsProvider(): {
  provider: SmsProviderName;
  fast2smsKey: string;
  fast2smsRoute: string;
  twilioSid: string;
  twilioToken: string;
  twilioFrom: string;
  textbeltKey: string;
} {
  const explicit = (process.env.SMS_PROVIDER || '').trim().toLowerCase();
  const genericKey = (process.env.SMS_API_KEY || '').trim();
  const fast2smsKey = (process.env.FAST2SMS_API_KEY || (explicit === 'fast2sms' ? genericKey : '')).trim();
  const fast2smsRoute = (process.env.FAST2SMS_ROUTE || 'q').trim();
  const twilioSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const twilioToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const twilioFrom = (process.env.TWILIO_FROM_NUMBER || '').trim();
  const textbeltKey = (
    process.env.TEXTBELT_API_KEY ||
    (explicit === 'textbelt' ? genericKey || 'textbelt' : '')
  ).trim();

  let provider: SmsProviderName = 'none';
  if (explicit === 'fast2sms' && fast2smsKey) {
    provider = 'fast2sms';
  } else if (explicit === 'twilio' && twilioSid && twilioToken && twilioFrom) {
    provider = 'twilio';
  } else if (explicit === 'textbelt' && textbeltKey) {
    provider = 'textbelt';
  } else if (fast2smsKey) {
    provider = 'fast2sms';
  } else if (twilioSid && twilioToken && twilioFrom) {
    provider = 'twilio';
  } else if (textbeltKey) {
    provider = 'textbelt';
  } else if (genericKey) {
    // Default generic SMS_API_KEY to Fast2SMS (India) unless set to 'textbelt'
    if (genericKey.toLowerCase().startsWith('textbelt')) {
      provider = 'textbelt';
    } else {
      provider = 'fast2sms';
    }
  }

  return {
    provider,
    fast2smsKey: fast2smsKey || (provider === 'fast2sms' ? genericKey : ''),
    fast2smsRoute,
    twilioSid,
    twilioToken,
    twilioFrom,
    textbeltKey: textbeltKey || (provider === 'textbelt' ? genericKey || 'textbelt' : ''),
  };
}

export function getSmsConfigSummary(): SmsConfigSummary {
  const cfg = resolveSmsProvider();
  return {
    configured: cfg.provider !== 'none',
    provider: cfg.provider,
    supportsIndia: cfg.provider !== 'none',
    supportsGlobal: cfg.provider === 'twilio' || cfg.provider === 'textbelt',
    freeTierInfo:
      cfg.provider === 'fast2sms'
        ? 'Fast2SMS configured (India SMS; ₹50 free trial credits on signup).'
        : cfg.provider === 'twilio'
          ? 'Twilio configured (Global SMS; 30-day free trial credits for verified numbers).'
          : cfg.provider === 'textbelt'
            ? 'Textbelt configured (key="textbelt" allows 1 free test SMS/day per IP).'
            : 'No SMS API key configured; mobile OTP requests automatically fall back to SMTP Gmail delivery.',
  };
}

export async function sendOtpSms(params: {
  phone?: string;
  countryCode?: string;
  otp: string;
  purpose?: 'register' | 'password_reset' | 'admin_2fa' | 'test';
}): Promise<SmsSendResult> {
  const cfg = resolveSmsProvider();
  const e164 = normalizeE164(params.phone || '', params.countryCode || '+91');
  if (!e164 || e164.replace(/\D/g, '').length < 7) {
    return {
      sent: false,
      configured: cfg.provider !== 'none',
      provider: cfg.provider,
      error: 'Valid mobile number is required for SMS delivery.',
    };
  }

  if (cfg.provider === 'none') {
    return {
      sent: false,
      configured: false,
      provider: 'none',
      error: 'No SMS provider configured (set FAST2SMS_API_KEY, TWILIO_*, or SMS_PROVIDER=textbelt).',
    };
  }

  const label =
    params.purpose === 'admin_2fa'
      ? 'Aathirai_Comic Admin 2FA'
      : params.purpose === 'password_reset'
        ? 'Aathirai_Comic Password Reset'
        : 'Aathirai_Comic';
  const messageText = `Your ${label} verification OTP is ${params.otp}. Valid for 10 minutes. Do not share this code.`;

  try {
    if (cfg.provider === 'fast2sms') {
      const indian10 = extractIndian10Digits(e164);
      if (!indian10) {
        return {
          sent: false,
          configured: true,
          provider: 'fast2sms',
          error: 'Fast2SMS supports Indian (+91) 10-digit mobile numbers only.',
        };
      }

      const payload =
        cfg.fast2smsRoute === 'otp'
          ? {
              route: 'otp',
              variables_values: params.otp,
              numbers: indian10,
            }
          : {
              route: 'q',
              message: messageText,
              language: 'english',
              flash: 0,
              numbers: indian10,
            };

      const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          authorization: cfg.fast2smsKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok && data?.return === true) {
        return {
          sent: true,
          configured: true,
          provider: 'fast2sms',
          messageId: String(data?.request_id || ''),
        };
      }
      return {
        sent: false,
        configured: true,
        provider: 'fast2sms',
        error: data?.message ? (Array.isArray(data.message) ? data.message.join(', ') : String(data.message)) : `Fast2SMS HTTP ${res.status}`,
      };
    }

    if (cfg.provider === 'twilio') {
      const authHeader = Buffer.from(`${cfg.twilioSid}:${cfg.twilioToken}`).toString('base64');
      const form = new URLSearchParams({
        To: e164,
        From: cfg.twilioFrom,
        Body: messageText,
      });

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.twilioSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
          signal: AbortSignal.timeout(10000),
        }
      );
      const data: any = await res.json().catch(() => ({}));
      if (res.ok && data?.sid) {
        return {
          sent: true,
          configured: true,
          provider: 'twilio',
          messageId: String(data.sid),
        };
      }
      return {
        sent: false,
        configured: true,
        provider: 'twilio',
        error: data?.message || `Twilio HTTP ${res.status}`,
      };
    }

    if (cfg.provider === 'textbelt') {
      const res = await fetch('https://textbelt.com/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: e164,
          message: messageText,
          key: cfg.textbeltKey || 'textbelt',
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok && data?.success === true) {
        return {
          sent: true,
          configured: true,
          provider: 'textbelt',
          messageId: String(data.textId || ''),
          quotaRemaining: typeof data.quotaRemaining === 'number' ? data.quotaRemaining : undefined,
        };
      }
      return {
        sent: false,
        configured: true,
        provider: 'textbelt',
        quotaRemaining: typeof data?.quotaRemaining === 'number' ? data.quotaRemaining : undefined,
        error: data?.error || `Textbelt HTTP ${res.status}`,
      };
    }

    return {
      sent: false,
      configured: false,
      provider: 'none',
      error: 'Unsupported SMS provider.',
    };
  } catch (err: any) {
    console.error('[Aathirai_Comic SMS] Dispatch error:', err?.message || err);
    return {
      sent: false,
      configured: true,
      provider: cfg.provider,
      error: err?.message || 'SMS network request failed.',
    };
  }
}

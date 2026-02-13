/**
 * Resend Email Service
 * Handles sending emails via Resend API
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Validate email address format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Get Resend configuration from environment
 */
function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const replyTo = process.env.REPLY_TO_EMAIL || 'noreply@coinpay.com';

  return { apiKey, replyTo };
}

/**
 * Send email via Resend API
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  try {
    // Get configuration
    const { apiKey, replyTo } = getResendConfig();

    // Validate configuration
    if (!apiKey) {
      return {
        success: false,
        error: 'Resend API key is not configured',
      };
    }

    // Validate input
    if (!isValidEmail(input.to)) {
      return {
        success: false,
        error: 'Invalid email address',
      };
    }

    if (!input.subject || input.subject.trim() === '') {
      return {
        success: false,
        error: 'Subject is required',
      };
    }

    if (!input.html || input.html.trim() === '') {
      return {
        success: false,
        error: 'HTML content is required',
      };
    }

    // Send via Resend API
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from || 'CoinPay <noreply@coinpayportal.com>',
        to: [input.to],
        subject: input.subject,
        html: input.html,
        reply_to: input.replyTo || replyTo,
      }),
    });

    // Handle response
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.message || `Resend API error: ${response.status}`,
      };
    }

    const data = await response.json();

    return {
      success: true,
      messageId: data.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email',
    };
  }
}

/**
 * Send bulk emails (for future use)
 */
export async function sendBulkEmails(
  emails: SendEmailInput[]
): Promise<SendEmailResult[]> {
  const results = await Promise.allSettled(emails.map((email) => sendEmail(email)));

  return results.map((result) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      success: false,
      error: result.reason?.message || 'Failed to send email',
    };
  });
}

/**
 * Mailgun Email Service
 * Handles sending emails via Mailgun API
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
 * Get Mailgun configuration from environment
 */
function getMailgunConfig() {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const replyTo = process.env.REPLY_TO_EMAIL || 'noreply@coinpay.com';

  return { apiKey, domain, replyTo };
}

/**
 * Send email via Mailgun API
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  try {
    // Get configuration
    const { apiKey, domain, replyTo } = getMailgunConfig();

    // Validate configuration
    if (!apiKey) {
      return {
        success: false,
        error: 'Mailgun API key is not configured',
      };
    }

    if (!domain) {
      return {
        success: false,
        error: 'Mailgun domain is not configured',
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

    // Prepare email data
    const formData = new FormData();
    formData.append('from', input.from || `CoinPay <noreply@${domain}>`);
    formData.append('to', input.to);
    formData.append('subject', input.subject);
    formData.append('html', input.html);
    formData.append('h:Reply-To', input.replyTo || replyTo);

    // Send via Mailgun API
    const url = `https://api.mailgun.net/v3/${domain}/messages`;
    const auth = Buffer.from(`api:${apiKey}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
      },
      body: formData,
    });

    // Handle response
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.message || `Mailgun API error: ${response.status}`,
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
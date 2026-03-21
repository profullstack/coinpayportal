/**
 * Spam Bot Detection for Merchant Registration
 *
 * Lightweight heuristics to block bot signups at registration time.
 * No CAPTCHAs — we want to allow legitimate AI agents.
 *
 * Signals checked:
 *   - Gibberish name patterns
 *   - Crypto address as name
 *   - Dotted-gmail evasion
 *   - Disposable email domains
 *   - Corporate email + gibberish name (scraped lists)
 *   - Timing (registration too fast)
 *   - Honeypot field (optional, if added to form)
 */

export interface SpamCheckResult {
  blocked: boolean;
  score: number; // 0-100, higher = more suspicious
  reasons: string[];
}

// ─── Disposable email domains ──────────────────────────────────────────────
const DISPOSABLE_DOMAINS = new Set([
  "dnsclick.com", "yopmail.com", "guerrillamail.com", "mailinator.com",
  "tempmail.com", "throwaway.email", "10minutemail.com", "trashmail.com",
  "zenvex.edu.pl", "sharklasers.com", "guerrillamailblock.com",
  "grr.la", "dispostable.com", "maildrop.cc", "mailnesia.com",
  "tempinbox.com", "fakeinbox.com", "emailondeck.com",
]);

// ─── Free email providers (not suspicious by themselves) ───────────────────
const FREE_PROVIDERS = new Set([
  "gmail.com", "hotmail.com", "yahoo.com", "outlook.com",
  "proton.me", "protonmail.com", "icloud.com", "aol.com",
  "mail.com", "msn.com", "comcast.net", "yahoo.co.uk",
  "me.com", "att.net", "mac.com", "telus.net", "live.com",
]);

// ─── Detection functions ───────────────────────────────────────────────────

function isGibberishName(name: string): boolean {
  if (!name || name.length < 10) return false;
  // Real human names: "John Smith", "Preshy", "Dris"
  if (/^[A-Z][a-z]+( [A-Z][a-z]+)*$/.test(name.trim())) return false;
  if (name.trim().length <= 12 && /^[A-Z][a-z]+$/.test(name.trim())) return false;

  // High case transitions = random generator
  const caseTransitions = (name.match(/[a-z][A-Z]|[A-Z][a-z]/g) || []).length;
  if (name.length > 15 && caseTransitions > 4) return true;

  // Low vowel ratio
  const letters = name.replace(/[^a-zA-Z]/g, "");
  if (letters.length > 12) {
    const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
    if (vowels / letters.length < 0.2) return true;
  }

  // Long random alpha string
  if (/^[a-zA-Z]{16,}$/.test(name)) {
    const pronounceable = (name.match(/[aeiou]{1,2}[^aeiou]{1,3}/gi) || []).join("");
    if (pronounceable.length < name.length * 0.5) return true;
  }

  return false;
}

function isCryptoAddressName(name: string): boolean {
  if (!name) return false;
  if (/^0x[a-fA-F0-9]{20,}$/.test(name)) return true;
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,}$/.test(name)) return true;
  return false;
}

function isDottedGmailEvasion(email: string): boolean {
  const match = email.match(/^(.+)@gmail\.com$/i);
  if (!match) return false;
  const local = match[1];
  const dots = (local.match(/\./g) || []).length;
  const segments = local.split(".");
  if (dots >= 3 && segments.filter((s) => s.length <= 2).length >= 3) return true;
  return false;
}

function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain || "");
}

function isCorporateWithGibberishName(name: string, email: string): boolean {
  if (!name || !email) return false;
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (FREE_PROVIDERS.has(domain)) return false;
  return isGibberishName(name);
}

// ─── Main check ────────────────────────────────────────────────────────────

export function checkSpamSignup(input: {
  name?: string;
  email: string;
  honeypot?: string; // hidden form field — should be empty
  registrationStartMs?: number; // timestamp when form was loaded
}): SpamCheckResult {
  const reasons: string[] = [];
  let score = 0;
  const name = input.name || "";

  // Honeypot: if filled, definitely a bot
  if (input.honeypot) {
    reasons.push("honeypot_filled");
    score += 100;
  }

  // Timing: form submitted in under 2 seconds = bot
  if (input.registrationStartMs) {
    const elapsed = Date.now() - input.registrationStartMs;
    if (elapsed < 2000) {
      reasons.push("too_fast");
      score += 40;
    } else if (elapsed < 5000) {
      reasons.push("suspicious_speed");
      score += 15;
    }
  }

  // Name checks
  if (isGibberishName(name)) {
    reasons.push("gibberish_name");
    score += 35;
  }

  if (isCryptoAddressName(name)) {
    reasons.push("crypto_address_name");
    score += 50;
  }

  // Email checks
  if (isDisposableEmail(input.email)) {
    reasons.push("disposable_email");
    score += 50;
  }

  if (isDottedGmailEvasion(input.email)) {
    reasons.push("dotted_gmail");
    score += 35;
  }

  if (isCorporateWithGibberishName(name, input.email)) {
    reasons.push("corporate_email_gibberish_name");
    score += 40;
  }

  // No name at all is moderately suspicious
  if (!name.trim()) {
    reasons.push("no_name");
    score += 15;
  }

  return {
    blocked: score >= 50,
    score: Math.min(score, 100),
    reasons,
  };
}

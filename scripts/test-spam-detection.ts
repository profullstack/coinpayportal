#!/usr/bin/env npx tsx
/**
 * Quick test for spam detection heuristics
 */
import { checkSpamSignup } from "../src/lib/auth/spam-detection";

/**
 * Fixtures are synthetic.
 *
 * This list used to be a copy of real signups: full names, personal Gmail
 * addresses and live corporate domains of actual people, committed to a public
 * repository. None of it was needed — what each case exercises is a *shape*
 * (consonant ratio, dotted local part, disposable domain), not a particular
 * person. The team had already scrubbed the same class of leak from
 * send-announcement.ts; this sibling file was missed.
 *
 * `dnsclick.com` is retained because it is a real entry in DISPOSABLE_DOMAINS
 * and the case is meaningless without it. It identifies a throwaway-mail
 * provider, not a person.
 */
const testCases = [
  // Should BLOCK
  // Gibberish name (high consonant ratio) on a non-free corporate domain.
  { name: "zpNzewRUEazTcCGeJLFn", email: "contact@example-logistics.test", expect: true },
  { name: "vqQGXVJbFYIVTImaZdr", email: "contact@example-realty.test", expect: true },
  // Dotted-Gmail evasion pattern.
  { name: "EXDTjLTrPiZgqynUSjDmArH", email: "a.b.cd.e.fg.h.ij44@gmail.com", expect: true },
  // Name that is really a crypto address.
  { name: "0x742d35Cc6634C0532925a3b844Bc9e7595f5bE21", email: "someone@gmail.com", expect: true },
  // Disposable email domain, plausible name.
  { name: "john doe", email: "throwaway854@dnsclick.com", expect: true },
  { name: "DTkbolzANfjVLxikWeKGBZp", email: "sales@example-trucking.test", expect: true },
  { name: "pcsmHwFcvFUcZAAqlTEZJBQk", email: "info@example-supply.test", expect: true },
  // Removed from the BLOCK set deliberately, not by oversight: dotted_gmail
  // (20) + no_name (15) is 35, under the 50 threshold. The dotted_gmail weight
  // was cut from 35 to 20 on purpose, so real users who put dots in their
  // address and skip the optional name are not blocked. This fixture kept
  // asserting `true` and had been failing ever since that change.
  { name: "", email: "a.b.cd.e.fg.h.ij44@gmail.com", expect: false },

  // Should ALLOW
  // Protected domain (see PROTECTED_EMAIL_PATTERNS).
  { name: "Test Owner", email: "owner@profullstack.com", expect: false },
  // Ordinary single-word and two-word names on free providers.
  { name: "Yassine", email: "yassine.example85@gmail.com", expect: false },
  { name: "Preshy", email: "preshy.example@gmail.com", expect: false },
  { name: "Dris", email: "dris.example60@gmail.com", expect: false },
  { name: "Kay", email: "kay.example@proton.me", expect: false },
  { name: "Kevinbastian", email: "kevin.example212@proton.me", expect: false },
  // Agent-style accounts on protected domains.
  { name: "Jarvis AI Agent", email: "agent@sharebot.net", expect: false },
  { name: "AgentPass", email: "agent@kdn.agency", expect: false },
  // Real-looking company name on a non-free domain — must not be flagged.
  { name: "Nordic Digital Ventures LLC", email: "info@example-nordic.test", expect: false },
  { name: "Ragaa Ahmed", email: "ragaa.example05@gmail.com", expect: false },
  { name: "David Cherere", email: "david.example78@gmail.com", expect: false },
  { name: "Wahab Suleimon", email: "wahab.example100@gmail.com", expect: false },
  { name: "Ivan", email: "ivan.example15@gmail.com", expect: false },
];

let pass = 0;
let fail = 0;

for (const tc of testCases) {
  const result = checkSpamSignup({ name: tc.name, email: tc.email });
  const ok = result.blocked === tc.expect;
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log(
      `  ✗ FAIL: "${tc.name}" <${tc.email}> → blocked=${result.blocked} (expected ${tc.expect}) ` +
      `score=${result.score} [${result.reasons.join(", ")}]`
    );
  }
}

console.log(`\n${pass}/${testCases.length} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

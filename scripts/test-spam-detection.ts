#!/usr/bin/env npx tsx
/**
 * Quick test for spam detection heuristics
 */
import { checkSpamSignup } from "../src/lib/auth/spam-detection";

const testCases = [
  // Should BLOCK
  { name: "zpNzewRUEazTcCGeJLFn", email: "monica.magallanes@logisticsplus.com", expect: true },
  { name: "vqQGXVJbFYIVTImaZdr", email: "a.poirier@capreit.net", expect: true },
  { name: "EXDTjLTrPiZgqynUSjDmArH", email: "n.o.ku.b.o.we.d.e.va44@gmail.com", expect: true },
  { name: "0x742d35Cc6634C0532925a3b844Bc9e7595f5bE21", email: "rondale@gmail.com", expect: true },
  { name: "john doe", email: "jemivol854@dnsclick.com", expect: true },
  { name: "DTkbolzANfjVLxikWeKGBZp", email: "irina@goamericantruck.com", expect: true },
  { name: "pcsmHwFcvFUcZAAqlTEZJBQk", email: "mbachup@comar.com", expect: true },
  { name: "", email: "n.o.ku.b.o.we.d.e.va44@gmail.com", expect: true },

  // Should ALLOW
  { name: "Anthony Ettinger", email: "anthony@profullstack.com", expect: false },
  { name: "Yassine", email: "tazayassine85@gmail.com", expect: false },
  { name: "Preshy", email: "devpreshy@gmail.com", expect: false },
  { name: "Dris", email: "drissfikri60@gmail.com", expect: false },
  { name: "Kay", email: "k1escrow@proton.me", expect: false },
  { name: "Kevinbastian", email: "mdhani212@proton.me", expect: false },
  { name: "Jarvis AI Agent", email: "jarvisagent@sharebot.net", expect: false },
  { name: "AgentPass", email: "kai@kdn.agency", expect: false },
  { name: "Nordic Digital Ventures LLC", email: "info@nakenlek.no", expect: false },
  { name: "Ragaa Ahmed", email: "ragaamouhamed05@gmail.com", expect: false },
  { name: "David Cherere", email: "daveu78@gmail.com", expect: false },
  { name: "Wahab Suleimon", email: "wahabsman100@gmail.com", expect: false },
  { name: "Ivan", email: "iasaltykov15@gmail.com", expect: false },
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

import { formatMoney, type BehindAction, type BehindCustomer } from './behind';

const owedText = (c: BehindCustomer) => c.owed.map((o) => formatMoney(o.amount, o.currency)).join(' + ');

/**
 * The email a merchant can send in one click. A flagged card gets only "it was
 * declined": naming fraud or a stolen card to the person holding it is what
 * Stripe tells you not to do.
 */
export function draftEmail(c: BehindCustomer): string | null {
  if (!c.email) return null;
  const from = c.business_name || 'us';
  const amount = owedText(c);
  const invoices = c.items.filter((i) => i.kind === 'invoice').map((i) => i.title.replace(/^Invoice /, ''));
  const ask: Record<BehindAction, string> = {
    unreachable: `I'm resending invoice ${invoices.join(', ')} because the first email didn't reach you. The amount due is ${amount}.`,
    chase: `Invoice ${invoices.join(', ')} for ${amount} is now well past due. Can we talk about getting it settled this week?`,
    remind: `A quick reminder that invoice ${invoices.join(', ')} for ${amount} is overdue. The payment link is in the original email.`,
    retry: `Your payment of ${amount} didn't go through. It looks temporary on the bank's side. Could you try again in the next few days?`,
    new_card: `Your payment of ${amount} didn't go through because the card details are no longer valid. Could you pay with another card?`,
    unfinished: `It looks like your payment of ${amount} wasn't finished. Do you still want to go ahead?`,
    call_bank: `Your payment of ${amount} was declined by your bank without a reason. Could you check with them, or pay another way?`,
    do_not_chase: `Your payment of ${amount} was declined. If you'd still like to go ahead, could you pay another way?`,
  };
  const subject = invoices.length ? `Invoice ${invoices.join(', ')} from ${from}` : `Your payment to ${from}`;
  const first = c.name.split(/\s+/)[0];
  const body = `Hi ${first},\n\n${ask[c.action]}\n\nThanks,\n${from}`;
  return `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

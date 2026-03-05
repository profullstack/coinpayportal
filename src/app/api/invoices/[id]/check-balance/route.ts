import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkBalance } from '@/lib/payments/monitor-balance';
import { sendEmail } from '@/lib/email';
import { invoicePaidMerchantTemplate } from '@/lib/email/invoice-templates';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * POST /api/invoices/[id]/check-balance
 * Public endpoint - checks blockchain balance for an invoice payment address.
 * Called by the invoice pay page during polling for faster payment detection.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        *,
        clients (id, name, email, company_name),
        businesses (id, name, merchant_id)
      `)
      .eq('id', id)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    // Only check sent/overdue invoices
    if (!['sent', 'overdue'].includes(invoice.status)) {
      return NextResponse.json({
        success: true,
        status: invoice.status,
        message: `Invoice is already ${invoice.status}`,
      });
    }

    if (!invoice.payment_address || !invoice.crypto_currency) {
      return NextResponse.json({
        success: false,
        error: 'Invoice has no payment address or crypto currency',
      });
    }

    // Check blockchain balance
    const balanceResult = await checkBalance(invoice.payment_address, invoice.crypto_currency);
    const expectedAmount = parseFloat(invoice.crypto_amount || '0');

    console.log(`[Invoice Check] ${id}: balance=${balanceResult.balance}, expected=${expectedAmount}, currency=${invoice.crypto_currency}`);

    if (expectedAmount > 0 && balanceResult.balance >= expectedAmount * 0.99) {
      const now = new Date().toISOString();

      // Mark as paid
      await supabase
        .from('invoices')
        .update({
          status: 'paid',
          paid_at: now,
          tx_hash: balanceResult.txHash || null,
          updated_at: now,
        })
        .eq('id', id);

      console.log(`[Invoice Check] Invoice ${invoice.invoice_number} PAID (${balanceResult.balance} ${invoice.crypto_currency})`);

      // Email merchant confirmation
      const { data: merchant } = await supabase
        .from('merchants')
        .select('email')
        .eq('id', invoice.businesses?.merchant_id || invoice.user_id)
        .single();

      if (merchant?.email) {
        try {
          const feeRate = parseFloat(invoice.fee_rate) || 0.01;
          const amount = parseFloat(invoice.amount);
          const template = invoicePaidMerchantTemplate({
            invoiceNumber: invoice.invoice_number,
            amount,
            currency: invoice.currency || 'USD',
            cryptoAmount: invoice.crypto_amount || '0',
            cryptoCurrency: invoice.crypto_currency || '',
            txHash: balanceResult.txHash || 'N/A',
            feeAmount: amount * feeRate,
            feeRate,
            merchantAmount: amount * (1 - feeRate),
            clientName: invoice.clients?.name,
            clientEmail: invoice.clients?.email,
            businessName: invoice.businesses?.name || 'CoinPay Merchant',
          });

          await sendEmail({
            to: merchant.email,
            subject: template.subject,
            html: template.html,
          });
          console.log(`[Invoice Check] Merchant email sent for ${invoice.invoice_number}`);
        } catch (emailErr) {
          console.error(`[Invoice Check] Email error for ${invoice.invoice_number}:`, emailErr);
        }
      }

      return NextResponse.json({
        success: true,
        status: 'paid',
        balance: balanceResult.balance,
        txHash: balanceResult.txHash,
        message: 'Payment confirmed!',
      });
    }

    return NextResponse.json({
      success: true,
      status: 'pending',
      balance: balanceResult.balance,
      expected: expectedAmount,
      message: balanceResult.balance > 0
        ? `Partial payment detected: ${balanceResult.balance} / ${expectedAmount}`
        : 'Waiting for payment...',
    });
  } catch (error) {
    console.error('[Invoice Check] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to check balance' },
      { status: 500 }
    );
  }
}

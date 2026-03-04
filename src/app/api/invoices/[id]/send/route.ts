import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { getCryptoPrice } from '@/lib/rates/tatum';
import { generatePaymentAddress, type SystemBlockchain } from '@/lib/wallets/system-wallet';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { sendEmail } from '@/lib/email';
import { invoiceSentTemplate } from '@/lib/email/invoice-templates';

/**
 * POST /api/invoices/[id]/send
 * Send an invoice to the client via email
 * - Calculates crypto_amount from current exchange rate
 * - Generates system intermediary payment address
 * - Sends email with payment link
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const decoded = verifyToken(token, jwtSecret);
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Get the invoice with client and business info
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select(`
        *,
        clients (id, name, email, company_name),
        businesses (id, name, merchant_id)
      `)
      .eq('id', id)
      .eq('user_id', decoded.userId)
      .single();

    if (fetchError || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.status !== 'draft' && invoice.status !== 'overdue') {
      return NextResponse.json({ success: false, error: `Cannot send invoice with status: ${invoice.status}` }, { status: 400 });
    }

    if (!invoice.crypto_currency) {
      return NextResponse.json({ success: false, error: 'Crypto currency must be set before sending' }, { status: 400 });
    }

    const clientEmail = invoice.clients?.email;
    if (!clientEmail) {
      return NextResponse.json({ success: false, error: 'Client email is required to send invoice' }, { status: 400 });
    }

    // Calculate crypto amount from current exchange rate
    const baseCrypto = invoice.crypto_currency.startsWith('USDC_')
      ? 'USDC'
      : invoice.crypto_currency.startsWith('USDT_')
        ? 'USDT'
        : invoice.crypto_currency;

    const cryptoAmount = await getCryptoPrice(
      parseFloat(invoice.amount),
      invoice.currency || 'USD',
      baseCrypto
    );

    // Generate system intermediary payment address
    const isPaidTier = await isBusinessPaidTier(supabase, invoice.business_id);
    const baseBlockchain = (invoice.crypto_currency.startsWith('USDC_')
      ? invoice.crypto_currency.replace('USDC_', '')
      : invoice.crypto_currency) as SystemBlockchain;

    const addressResult = await generatePaymentAddress(
      supabase,
      invoice.id,
      invoice.business_id,
      baseBlockchain,
      invoice.merchant_wallet_address || '',
      cryptoAmount,
      isPaidTier
    );

    if (!addressResult.success) {
      return NextResponse.json(
        { success: false, error: `Failed to generate payment address: ${addressResult.error}` },
        { status: 500 }
      );
    }

    // Calculate fee amount
    const feeAmount = parseFloat(invoice.amount) * parseFloat(invoice.fee_rate);

    // Update invoice
    const { data: updatedInvoice, error: updateError } = await supabase
      .from('invoices')
      .update({
        status: 'sent',
        crypto_amount: cryptoAmount.toFixed(8),
        payment_address: addressResult.address,
        fee_amount: feeAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(`*, clients (id, name, email, company_name), businesses (id, name)`)
      .single();

    if (updateError) {
      return NextResponse.json({ success: false, error: 'Failed to update invoice' }, { status: 500 });
    }

    // Send email to client
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
    const paymentLink = `${appUrl}/invoices/${invoice.id}/pay`;

    const businessName = invoice.businesses?.name || 'CoinPay Merchant';
    const template = invoiceSentTemplate({
      invoiceNumber: invoice.invoice_number,
      amount: parseFloat(invoice.amount),
      currency: invoice.currency || 'USD',
      cryptoAmount: cryptoAmount.toFixed(8),
      cryptoCurrency: invoice.crypto_currency,
      dueDate: invoice.due_date,
      businessName,
      paymentLink,
      notes: invoice.notes,
    });

    await sendEmail({
      to: clientEmail,
      subject: template.subject,
      html: template.html,
    });

    return NextResponse.json({ success: true, invoice: updatedInvoice });
  } catch (error) {
    console.error('Send invoice error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

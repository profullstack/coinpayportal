/**
 * CoinPay — WooCommerce Blocks payment-method registration.
 *
 * Loaded by includes/class-wc-gateway-coinpay-blocks.php via
 * wp_register_script. No build step — we use the globals WP exposes:
 *   - window.wc.wcBlocksRegistry.registerPaymentMethod
 *   - window.wp.element.createElement
 *   - window.wc.wcSettings.getSetting
 *   - window.wp.htmlEntities.decodeEntities
 *   - window.wp.i18n.__
 *
 * Flow:
 *   1. Block checkout shows "CoinPay" as a choice with the configured title.
 *   2. Customer clicks Place Order.
 *   3. Block checkout POSTs to /wc/store/checkout with payment_method=coinpay.
 *   4. Server calls our existing WC_Gateway_CoinPay::process_payment().
 *   5. The result (redirect URL to CoinPay hosted checkout) is returned to
 *      the block, which performs the redirect.
 * No client-side payment logic required — we're a redirect-style gateway.
 */
( function () {
    const registry = window.wc && window.wc.wcBlocksRegistry;
    const settings = window.wc && window.wc.wcSettings;
    const element  = window.wp && window.wp.element;
    const html     = window.wp && window.wp.htmlEntities;
    const i18n     = window.wp && window.wp.i18n;

    if ( ! registry || ! settings || ! element || ! html || ! i18n ) {
        // Running outside block checkout — nothing to do.
        return;
    }

    const { registerPaymentMethod } = registry;
    const { getSetting }            = settings;
    const { createElement }         = element;
    const { decodeEntities }        = html;
    const { __ }                    = i18n;

    const data = getSetting( 'coinpay_data', {} );
    const label = decodeEntities(
        data.title || __( 'CoinPay (crypto + card)', 'coinpay-woocommerce' )
    );

    const Content = () => createElement(
        'div',
        { className: 'coinpay-blocks-description' },
        decodeEntities(
            data.description ||
                __(
                    'You will be redirected to CoinPay to complete payment with crypto or a credit card.',
                    'coinpay-woocommerce'
                )
        )
    );

    const Label = ( props ) => {
        const PaymentMethodLabel = props.PaymentMethodLabel;
        if ( PaymentMethodLabel ) {
            return createElement( PaymentMethodLabel, { text: label } );
        }
        return createElement( 'span', null, label );
    };

    registerPaymentMethod( {
        name:        'coinpay',
        label:       createElement( Label ),
        content:     createElement( Content ),
        edit:        createElement( Content ),
        canMakePayment: () => true,
        ariaLabel:   label,
        supports: {
            features: ( data.supports && Array.isArray( data.supports ) )
                ? data.supports
                : [ 'products' ],
        },
    } );
} )();

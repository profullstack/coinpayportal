# PRD.md

## Product Requirements Document
## CoinPay for WooCommerce and WHMCS
## Version: 0.1.0
## Date: 2026-04-16

## 1. Overview

CoinPay needs first-party merchant plugins for WooCommerce and WHMCS so merchants can accept crypto and credit card payments through CoinPay with minimal setup, consistent branding, and a unified API experience.

This project covers two installable integrations:

- CoinPay for WooCommerce
- CoinPay for WHMCS

Both integrations must use CoinPay as the payment orchestration layer and should support hosted checkout first, with room for deeper native checkout and advanced platform-specific features later.

The goal is to make CoinPay easy to install for merchants already using WordPress + WooCommerce or WHMCS, while preserving CoinPay's positioning around crypto, card payments, and extensible merchant tooling.

## 2. Goals

### Business Goals

- Increase merchant adoption by meeting merchants where they already sell
- Reduce custom integration effort for small and mid-size merchants
- Establish CoinPay as a dual-mode payment provider for crypto and cards
- Create reusable plugin architecture patterns for later platform integrations like BigCommerce, PrestaShop, Magento, and Shopify if feasible
- Drive recurring revenue through plugin-enabled merchant subscriptions and transaction volume

### Product Goals

- Allow a merchant to install a plugin, enter API credentials, and begin accepting payments quickly
- Support both crypto and credit card payment methods through the same CoinPay integration
- Provide order and invoice synchronization between merchant platform and CoinPay
- Offer reliable payment status updates through webhooks plus manual reconciliation tools
- Keep implementation simple enough for a fast MVP while leaving room for subscriptions, refunds, escrow, and marketplace use cases later

### Non-Goals for MVP

- Full on-site embedded PCI-heavy card processing UI
- Native multi-vendor marketplace split payouts
- Full escrow milestone workflows inside WooCommerce or WHMCS admin
- Dispute management UI inside the plugins
- Subscription rebilling for all gateways and all order types
- Deep analytics dashboards beyond basic payment logs and links back to CoinPay

## 3. Platforms

### 3.1 WooCommerce

Primary use case:
- Ecommerce stores selling physical or digital products through WooCommerce checkout

Merchant expectations:
- Payment gateway appears alongside other WooCommerce gateways
- Simple merchant settings in WordPress admin
- Order status updates when payment is created, paid, failed, expired, or refunded
- Notes added to the order for key CoinPay events
- Clear customer redirect and return flow

### 3.2 WHMCS

Primary use case:
- Hosting providers, SaaS operators, domain sellers, infrastructure providers, agencies, and service businesses using WHMCS invoicing

Merchant expectations:
- Payment gateway available on invoices and checkout flows
- Ability to pay unpaid invoices with CoinPay
- Reliable mapping between WHMCS invoice state and CoinPay payment state
- Clear admin logs for payment attempts and webhook activity
- Minimal disruption to existing WHMCS billing workflows

## 4. Problem Statement

CoinPay currently requires merchants to integrate at the API level or through custom implementation. That limits adoption among merchants who prefer off-the-shelf extensions. WooCommerce and WHMCS merchants expect ready-made payment plugins that behave like native gateways.

Without these plugins:
- merchants face technical integration friction
- CoinPay loses merchants to easier-to-install competitors
- support burden rises because every merchant integration is custom
- platform discoverability is weak compared with marketplace-listed payment extensions

## 5. Users

### 5.1 Merchant Admin

Who they are:
- Store owner
- Hosting company operator
- Agency admin
- Ecommerce manager
- Technical founder

What they need:
- Install and configure quickly
- Trust payment status accuracy
- Let customers choose crypto or card
- Access logs when something goes wrong
- Avoid manual invoice/order reconciliation

### 5.2 Customer / Buyer

Who they are:
- Shopper checking out in WooCommerce
- Hosting or SaaS customer paying a WHMCS invoice

What they need:
- Clear payment choice
- Fast redirect to CoinPay hosted checkout
- Transparent status and return flow
- Clear confirmation when payment succeeds or fails

### 5.3 CoinPay Operations / Support

What they need:
- Predictable request and webhook payloads
- Traceable merchant and transaction identifiers
- Debug logs without leaking secrets
- Versioned plugin releases and upgrade path

## 6. Core Value Proposition

CoinPay gives merchants one integration for:
- crypto payments
- credit card payments
- a unified hosted checkout experience
- merchant-friendly setup on platforms they already use

## 7. Functional Requirements

## 7.1 Shared Requirements Across Both Plugins

### 7.1.1 Merchant Authentication and Setup

The plugin must allow the merchant to configure:
- CoinPay API base URL
- API key or merchant credential pair
- webhook secret or signature verification secret
- environment mode:
  - sandbox
  - production
- enabled payment methods:
  - crypto only
  - card only
  - crypto + card
- default settlement currency or display currency where supported
- debug logging enabled or disabled

Acceptance criteria:
- Merchant can save credentials securely
- Plugin validates required credentials before enabling checkout
- Plugin exposes connection test action
- Failed credential validation shows a human-readable error

### 7.1.2 Payment Creation

The plugin must create a CoinPay payment session when a customer chooses CoinPay and submits payment.

The session creation payload should include, as available:
- platform identifier
- merchant identifier
- order or invoice identifier
- amount
- currency
- customer email
- customer name
- callback/return URL
- cancel URL
- webhook correlation metadata
- line item summary
- billing metadata where allowed
- selected payment mode if customer chose crypto vs card

Acceptance criteria:
- Unique CoinPay payment created per order or invoice payment attempt
- Payment metadata includes platform order/invoice reference
- Duplicate submissions are handled idempotently when possible

### 7.1.3 Hosted Checkout Redirect

For MVP, both plugins should use CoinPay hosted checkout after payment creation.

Acceptance criteria:
- Customer is redirected to CoinPay hosted checkout
- Hosted checkout URL is validated before redirect
- Merchant branding options can be passed if supported by CoinPay
- Return flow brings user back to originating platform

### 7.1.4 Payment Status Synchronization

The plugin must consume CoinPay webhook events and update platform records accordingly.

Supported status classes for MVP:
- created
- pending
- paid / completed
- failed
- expired
- cancelled
- refunded, if supported by CoinPay API in MVP

Acceptance criteria:
- Webhook signature is verified
- Invalid webhook signatures are rejected
- Webhook events are logged
- Duplicate events are safely ignored or handled idempotently
- Order or invoice status updates map consistently
- Admin can trigger manual sync from plugin UI for a given order/invoice if feasible

### 7.1.5 Admin Logs

The plugin must provide logs for:
- payment creation request attempts
- payment creation response summary
- webhook receipt
- webhook validation result
- order/invoice status changes
- manual retry or reconciliation actions

Acceptance criteria:
- Logs must redact secrets
- Logs must be easy to disable in production
- Logs must include timestamps and correlation IDs

### 7.1.6 Customer Messaging

The plugin must display clear messages to the buyer during:
- payment selection
- redirect
- return after payment
- failure or expiration states

Acceptance criteria:
- Messaging is understandable and short
- Merchant can customize gateway title and description
- Return page clearly explains next step

## 7.2 WooCommerce Functional Requirements

### 7.2.1 Gateway Registration

The plugin must register CoinPay as a WooCommerce payment gateway.

Requirements:
- Admin can enable or disable the gateway
- Admin can set title shown at checkout
- Admin can set customer-facing description
- Admin can restrict availability by currency or country if needed later

Acceptance criteria:
- CoinPay appears in WooCommerce payment settings
- CoinPay appears at checkout when enabled and validly configured

### 7.2.2 Order Flow

Expected flow:
1. Customer adds products to cart
2. Customer proceeds to checkout
3. Customer selects CoinPay
4. WooCommerce creates order
5. Plugin calls CoinPay API to create payment
6. Customer is redirected to CoinPay hosted checkout
7. CoinPay sends webhook updates
8. WooCommerce order status updates
9. Customer returns to success or failure page

Suggested WooCommerce status mapping:
- CoinPay created/pending -> on-hold or pending payment
- CoinPay paid/completed -> processing or completed depending on product type
- CoinPay failed/expired/cancelled -> failed or pending payment based on merchant preference
- CoinPay refunded -> refunded

Acceptance criteria:
- Order note added for payment creation and status updates
- Store admin can see CoinPay transaction reference in order admin
- Customer thank-you page reflects latest known state

### 7.2.3 Refund Support

MVP options:
- Phase 1: read-only refund awareness if refunds happen in CoinPay dashboard/API
- Phase 2: merchant can initiate refunds from WooCommerce admin

Acceptance criteria for MVP:
- If CoinPay sends refund webhook, WooCommerce order note and status update correctly
- If native refund action is not implemented yet, admin sees a note directing them to CoinPay dashboard

### 7.2.4 Currency and Totals Handling

Requirements:
- Plugin must respect WooCommerce order currency
- Plugin must send final payable amount including taxes, shipping, and discounts
- Plugin must preserve order total integrity between WooCommerce and CoinPay

Acceptance criteria:
- Amount mismatch checks exist
- Unsupported currency produces clear admin or customer error
- No silent fallback to wrong currency

### 7.2.5 Webhook Endpoint

Requirements:
- Public endpoint in WordPress for CoinPay webhook delivery
- Signature verification
- Graceful handling when order not found
- Safe behavior on repeated webhook calls

Acceptance criteria:
- Endpoint can be copy-pasted into CoinPay merchant dashboard
- Admin page displays webhook URL
- Endpoint responses are machine-friendly for CoinPay retries

## 7.3 WHMCS Functional Requirements

### 7.3.1 Gateway Module Registration

The plugin must register as a WHMCS payment gateway module.

Requirements:
- Admin can enable or disable the module
- Admin can configure API credentials
- Admin can define title shown to customers
- Admin can choose allowed payment modes if supported

Acceptance criteria:
- CoinPay shows up as a selectable payment gateway in WHMCS
- Invoices can be paid through CoinPay when enabled

### 7.3.2 Invoice Payment Flow

Expected flow:
1. Customer opens unpaid invoice
2. Customer selects CoinPay
3. Plugin creates CoinPay payment session tied to WHMCS invoice ID
4. Customer is redirected to CoinPay hosted checkout
5. CoinPay webhooks update payment state
6. WHMCS records payment and marks invoice paid when appropriate

Acceptance criteria:
- Payment attempts are traceable by invoice ID
- Customer can retry payment if prior attempt expired or failed
- Successful payment records transaction reference inside WHMCS

### 7.3.3 Callback / Notification Handling

Requirements:
- WHMCS callback file or route receives CoinPay notifications
- Signature verification
- Invoice lookup by metadata and reference
- Safe idempotent handling of repeated events

Acceptance criteria:
- Paid invoice is recorded once
- Duplicate callbacks do not create duplicate payments
- Failed lookup cases are logged for admin review

### 7.3.4 Partial Payments and Credits

MVP stance:
- Defer complex partial-payment support unless already natively supported by CoinPay session model
- Prefer full invoice payment only for initial release

Acceptance criteria:
- Plugin clearly documents whether partial payment is unsupported
- Unsupported partial payment attempts fail safely and clearly

### 7.3.5 Subscription and Recurring Billing

MVP stance:
- Manual invoice payment support first
- Automated recurring billing tokenization or saved payment method support deferred

Acceptance criteria:
- Existing WHMCS recurring invoice generation remains unaffected
- Customers can pay generated invoices manually via CoinPay
- Future recurring features have placeholders in architecture but no half-implemented UI

## 8. API Requirements

Both plugins should integrate against a shared CoinPay API contract.

Required capabilities from CoinPay API:
- create payment session
- retrieve payment status
- verify webhook event or webhook signatures
- optionally fetch payment details for reconciliation
- optionally fetch refund status
- merchant-friendly hosted checkout URL generation
- metadata passthrough for order/invoice correlation

Recommended API fields:
- payment_id
- merchant_id
- external_reference
- external_type such as order or invoice
- amount
- currency
- payment_method_type
- status
- hosted_checkout_url
- created_at
- updated_at
- customer_email
- metadata object

Recommended webhook event fields:
- event_id
- event_type
- payment_id
- external_reference
- status
- amount
- currency
- signature or signed headers
- occurred_at

## 9. UX Requirements

## 9.1 Merchant UX

Settings pages should be simple and minimal.

Required sections:
- credentials
- environment
- payment method options
- webhook information
- logging options
- support / docs links

Merchant must be able to:
- test connection
- copy webhook URL
- understand configuration health at a glance

## 9.2 Buyer UX

Buyer-facing experience should:
- show CoinPay as a trusted payment option
- optionally mention crypto and credit card support in short text
- explain redirect behavior
- explain success, pending, and failure states on return

## 10. Security Requirements

- Never expose secret API credentials in frontend HTML or JS
- Store secrets using platform-appropriate secure configuration methods
- Verify all webhook signatures
- Sanitize and validate all inbound data
- Escape admin-rendered logs and notices
- Prevent CSRF where relevant for admin actions
- Prevent unauthorized manual sync actions
- Minimize PII storage in plugin logs
- Redact secrets and sensitive headers in debug output
- Follow WordPress and WHMCS secure coding standards as applicable

## 11. Reliability Requirements

- Idempotent webhook processing
- Retry-safe payment creation logic where feasible
- Graceful handling of CoinPay API downtime
- Clear admin notices for misconfiguration
- Manual reconciliation option for support teams
- No fatal checkout breakage if CoinPay is disabled or misconfigured; gateway should hide itself or fail clearly

## 12. Performance Requirements

- Payment creation call should complete fast enough to keep checkout responsive
- Webhook processing should be lightweight
- Plugin should avoid blocking admin pages with remote calls unless initiated by merchant
- Connection test should be explicit rather than automatic on every settings page load

## 13. Reporting and Analytics

MVP minimum:
- transaction reference visible in order/invoice admin
- payment status visible in admin
- logs for troubleshooting

Future:
- dashboard widgets for payment volume
- conversion by payment method
- failed/expired payment recovery metrics
- crypto vs card breakdown

## 14. Compatibility

## 14.1 WooCommerce

Target:
- current stable WordPress
- current stable WooCommerce
- PHP version range aligned with supported WooCommerce baseline

Must support:
- classic checkout initially
- block checkout support can be phase 2 unless implementation is straightforward

## 14.2 WHMCS

Target:
- currently supported stable WHMCS versions
- PHP version range aligned with WHMCS support matrix

Must support:
- standard invoice payment flow
- client area payment pages
- admin invoice visibility

## 15. Architecture

## 15.1 Shared Internal Package Strategy

Recommended implementation:
- one monorepo for plugins
- shared internal SDK package for CoinPay API communication
- platform-specific adapters:
  - packages/coinpay-sdk
  - plugins/woocommerce
  - plugins/whmcs

Shared SDK responsibilities:
- auth headers
- API client methods
- webhook signature verification helpers
- payload normalization
- error normalization
- correlation ID generation
- common logger interface

Benefits:
- faster iteration
- less duplicated business logic
- easier future platform expansion

## 15.2 Plugin Architecture Principles

- hosted checkout first
- platform-native admin settings
- thin platform layer, shared API logic
- explicit event mapping layer from CoinPay statuses to platform statuses
- no business logic hidden in templates
- versioned API compatibility layer in case CoinPay API changes later

## 16. Admin Settings Detail

Common settings:
- Enable CoinPay
- Display title
- Display description
- Sandbox mode
- API base URL
- Public identifier if required
- Secret API key
- Webhook secret
- Enable crypto
- Enable cards
- Default order state while pending
- Enable debug logging

WooCommerce-specific settings:
- Paid order target state for physical goods
- Paid order target state for virtual/downloadable goods
- Optional icon/logo URL
- Optional countries/currencies restriction

WHMCS-specific settings:
- Invoice paid mapping
- Failed payment messaging
- Optional custom return page behavior

## 17. Error Handling

Customer-safe errors:
- Could not create payment session
- Unsupported currency
- Payment session expired
- Payment failed
- Payment still pending

Admin-focused errors:
- invalid credentials
- webhook signature mismatch
- invoice/order not found
- amount mismatch
- duplicate event
- remote API timeout
- plugin version/API version mismatch

## 18. MVP Scope

## 18.1 WooCommerce MVP

Included:
- gateway registration
- merchant settings
- hosted checkout redirect
- payment creation
- webhook processing
- order status updates
- admin order notes with CoinPay references
- basic logs
- connection test
- sandbox + production modes
- crypto/card mode toggle

Excluded from MVP:
- block checkout optimization if it slows launch
- native refunds from WooCommerce admin
- subscriptions
- saved cards
- escrow UI
- multi-vendor payout logic

## 18.2 WHMCS MVP

Included:
- gateway registration
- merchant settings
- hosted checkout redirect
- invoice payment creation
- webhook/callback processing
- invoice paid recording
- transaction reference logging
- sandbox + production modes
- crypto/card mode toggle
- basic logs

Excluded from MVP:
- automated recurring token billing
- partial payment complexity
- deep reporting
- refunds from WHMCS admin
- escrow UI

## 19. Phase 2 Scope

Potential next features:
- WooCommerce subscriptions support
- WHMCS recurring billing enhancements
- native refunds from platform admin
- embedded checkout option
- branded hosted checkout configuration
- payment method-specific messaging
- on-platform escrow/deposit workflows
- better analytics
- marketplace compatibility extensions
- multicurrency enhancements
- support for pay links and admin-created invoices in WooCommerce

## 20. Success Metrics

### Launch Metrics
- plugin installs
- active merchants
- merchants who complete credential setup
- successful test connection rate
- first payment completion rate

### Revenue Metrics
- GMV processed through plugins
- crypto/card mix
- plugin-driven MRR from CoinPay merchant subscriptions
- payment conversion rate

### Reliability Metrics
- webhook success rate
- duplicate event handling rate
- payment/order reconciliation failure rate
- support ticket volume per active merchant

## 21. Risks

- CoinPay API may need additional fields or webhook guarantees for plugin-grade reliability
- Shopify-like expectations may spill into WooCommerce/WHMCS requests before core plugin maturity
- Card processing compliance and UX requirements may vary by merchant geography
- WooCommerce ecosystem variation may create theme/checkout plugin conflicts
- WHMCS merchant environments may lag on PHP or WHMCS versions
- Refund and recurring billing expectations may arrive before MVP is stabilized

## 22. Open Questions

- What exact CoinPay payment statuses exist today and which should be canonical for plugins?
- Does CoinPay support card and crypto under the same payment session or separate session types?
- Does CoinPay expose refund APIs now or only dashboard/manual operations?
- What level of branding control exists for hosted checkout?
- Does CoinPay support sandbox webhooks distinct from production?
- What metadata limits exist on CoinPay payment creation?
- Should WooCommerce block checkout support be in MVP or immediately after?
- Does WHMCS need support for multiple CoinPay gateway instances per currency or per business line?

## 23. Release Plan

### Milestone 1
Shared SDK + API contract hardening

### Milestone 2
WooCommerce MVP alpha

### Milestone 3
WHMCS MVP alpha

### Milestone 4
Internal beta with test merchants

### Milestone 5
Marketplace packaging, docs, support workflows, public launch

## 24. Documentation Requirements

Need docs for:
- installation
- credential setup
- sandbox testing
- webhook configuration
- order/invoice status mapping
- troubleshooting
- refund limitations
- supported versions
- upgrade notes
- FAQ

## 25. Technical Recommendations

### Recommended Tech Approach

Use a monorepo with:
- shared JavaScript or TypeScript SDK if your internal ecosystem prefers it
- platform packaging per plugin
- CI pipeline to build release zips
- semantic versioning for both plugins and shared SDK

However, each plugin must ultimately ship in the native format expected by the target platform:
- WooCommerce plugin zip
- WHMCS gateway/module package

### Suggested Repository Layout

```text
coinpayportal/
  packages/
    coinpay-sdk/
  plugins/
    woocommerce/
    whmcs/
  docs/
  scripts/
```

## 26. Final Recommendation

Build WooCommerce first, but define the shared SDK and webhook/status model before writing platform-specific logic. WHMCS should follow immediately after using the same API client, signature verification, event mapping, and logging conventions.

This gives CoinPay:
- fastest merchant adoption path
- lowest long-term maintenance cost
- clean foundation for future plugins on other platforms

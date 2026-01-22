# Credit Card Processing Decision Document

**Date**: January 22, 2025  
**Status**: Pending Provider Approval  
**Decision Makers**: CoinPay Team

---

## Executive Summary

After comprehensive research into credit card processing options for CoinPay, we have decided to pursue **Checkout.com Marketplaces** as our primary provider, with **Adyen for Platforms** as a backup option. Both providers require a sales conversation before sandbox access can be granted.

---

## Business Requirements

| Requirement | Priority | Notes |
|-------------|----------|-------|
| One account managing multiple businesses | Must Have | Similar to current crypto model |
| 1% commission on all payments | Must Have | Platform fee sent to house account |
| Lower fees than Stripe | Must Have | Stripe charges 2.9% + $0.30 |
| Faster settlements | Should Have | Daily or instant payouts preferred |
| International support - US and EU | Must Have | Global merchant base |
| Each business as their own merchant | Must Have | Sub-merchant/PayFac model |
| Better support than Stripe | Should Have | Dedicated account management |
| Flexible account structures | Must Have | Multi-business from single account |
| Self-service signup | Nice to Have | Not available for marketplace solutions |
| Fraud detection included | Must Have | No additional integration required |

---

## Options Evaluated

### Option 1: Become a Full Payment Facilitator

**Description**: Register directly with Visa/Mastercard, partner with sponsor bank, handle all compliance.

**Verdict**: ❌ **REJECTED**

**Reasons**:
- $500K-$2M+ upfront investment
- 6-18 months to go live
- Full PCI-DSS Level 1 compliance burden
- Requires dedicated compliance team
- Overkill for our current scale

---

### Option 2: PayFac-as-a-Service

**Description**: Partner with a provider that handles PayFac infrastructure while we control merchant experience.

**Verdict**: ✅ **SELECTED**

**Providers Evaluated**:

| Provider | Marketplace Support | Self-Service | International | Fraud Included | Decision |
|----------|---------------------|--------------|---------------|----------------|----------|
| **Checkout.com** | ✅ Excellent | ❌ Sales call | ✅ 150+ countries | ✅ Yes | **PRIMARY** |
| **Adyen** | ✅ Excellent | ❌ Sales call | ✅ Global | ✅ Yes | **BACKUP** |
| Finix | ✅ Good | ❌ Sales call | ⚠️ US/Canada/EU | ✅ Yes | Considered |
| Payrix | ✅ Good | ❌ Sales call | ⚠️ Limited | ✅ Yes | Considered |
| Braintree | ✅ Good | ✅ Yes | ✅ 45+ countries | ✅ Yes | Rejected - PayPal owned |
| Square | ⚠️ Limited | ✅ Yes | ❌ US only | ✅ Yes | Rejected - US only |
| Stripe Connect | ✅ Good | ✅ Yes | ✅ Global | ✅ Yes | Rejected - Poor multi-business UX |

---

### Option 3: Direct Acquirer Integration

**Description**: Work directly with acquiring banks like Worldpay, Fiserv, or Global Payments.

**Verdict**: ❌ **REJECTED**

**Reasons**:
- Sub-merchant support varies significantly
- More complex onboarding process
- Less modern APIs
- PCI compliance burden higher

---

## Selected Solution: Checkout.com Marketplaces

### Why Checkout.com?

1. **Best API Experience**: Modern REST API with excellent documentation
2. **Transparent Pricing**: Interchange++ model, typically 2.2-2.5% total
3. **Fraud Detection Included**: ML-based fraud prevention at no extra cost
4. **PCI Compliance Simplified**: Use Frames.js for SAQ-A level compliance
5. **Native Marketplace Support**: Built-in split payments for commission model
6. **International Coverage**: 150+ countries, multi-currency support
7. **Commission Flexibility**: Supports fixed, variable, or compound fees per seller

### Key Features

| Feature | Included |
|---------|----------|
| Sub-entity/merchant management | ✅ |
| Split payments | ✅ |
| Automated payouts to merchants | ✅ |
| Fraud detection | ✅ |
| 3D Secure for EU compliance | ✅ |
| PCI-compliant card input | ✅ |
| Webhooks for events | ✅ |
| Dashboard for management | ✅ |

### Pricing Estimate

| Component | Cost |
|-----------|------|
| Interchange fees | ~1.5-2.5% |
| Checkout.com markup | ~0.2-0.3% |
| **Total processing cost** | ~2.0-2.8% |
| **Our 1% commission** | On top |
| **Merchant effective rate** | ~3.0-3.8% |

---

## Backup Solution: Adyen for Platforms

### Why Adyen as Backup?

1. **Global Leader**: Powers Uber, Spotify, eBay
2. **Enterprise-Grade**: Excellent for high volume
3. **Strong Fraud Protection**: RevenueProtect included
4. **Similar Features**: Split payments, sub-merchant support

### When to Use Adyen Instead

- If Checkout.com has unfavorable terms
- If we need stronger enterprise features
- If Checkout.com approval is delayed significantly

---

## Rejected Alternatives

### Stripe Connect
**Reason**: User explicitly wanted to avoid Stripe due to:
- Complex multi-business account management
- Account holds and poor support
- Difficult onboarding for sub-merchants

### Braintree
**Reason**: Owned by PayPal, likely to have similar issues to Stripe with account management and holds.

### Square
**Reason**: US-only, limited international support. Does not meet EU requirement.

### Full PayFac
**Reason**: Massive upfront investment and compliance burden not justified at current scale.

---

## Implementation Plan

Detailed implementation plan available in: [`/plans/checkout-com-implementation.md`](../plans/checkout-com-implementation.md)

### High-Level Architecture

```mermaid
graph TB
    subgraph CoinPay Platform
        UI[Merchant Dashboard]
        API[CoinPay API]
        
        subgraph Payment Methods
            Crypto[Crypto Payments]
            Cards[Card Payments - NEW]
        end
    end
    
    subgraph Card Processing
        Provider[Checkout.com or Adyen]
        Onboard[Sub-Merchant Onboarding]
        Process[Payment Processing]
        Payout[Merchant Payouts]
    end
    
    UI --> API
    API --> Crypto
    API --> Cards
    Cards --> Provider
    Provider --> Onboard
    Provider --> Process
    Provider --> Payout
```

### Database Changes

New tables required:
- `card_merchant_accounts` - Sub-merchant registration with provider
- `card_payments` - Card payment transactions
- `card_payouts` - Payouts to merchant bank accounts
- `card_webhook_logs` - Webhook event logging

### API Endpoints

New endpoints:
- `POST /api/card-payments/create` - Create card payment
- `GET /api/card-payments/[id]` - Get payment status
- `POST /api/card-merchants/onboard` - Onboard sub-merchant
- `GET /api/card-merchants/[id]` - Get merchant status
- `POST /api/webhooks/checkout` - Receive provider webhooks

---

## Current Status

| Step | Status | Notes |
|------|--------|-------|
| Research complete | ✅ Done | |
| Provider selected | ✅ Done | Checkout.com primary, Adyen backup |
| Implementation plan | ✅ Done | See /plans/checkout-com-implementation.md |
| Contact Checkout.com | 🔄 In Progress | Awaiting response |
| Contact Adyen | 🔄 In Progress | Awaiting response |
| Receive sandbox access | ⏳ Pending | |
| Begin implementation | ⏳ Pending | Blocked on sandbox access |

---

## Next Steps

1. **Wait for provider response** from Checkout.com and/or Adyen
2. **Evaluate terms** when received
3. **Obtain sandbox credentials**
4. **Begin implementation** following the plan in `/plans/checkout-com-implementation.md`

---

## Contact Information

### Checkout.com
- **Website**: https://www.checkout.com
- **Product**: Marketplaces
- **How to Contact**: Click "Get in touch" on website

### Adyen
- **Website**: https://www.adyen.com
- **Product**: SaaS Platforms
- **How to Contact**: Menu → Businesses we serve → SaaS Platforms → Get in touch

---

## References

- [Credit Card Processing Research](/plans/credit-card-processing-research.md)
- [Checkout.com Implementation Plan](/plans/checkout-com-implementation.md)
- [CoinPay Architecture](/docs/ARCHITECTURE.md)
- [CoinPay Database Schema](/docs/DATABASE.md)

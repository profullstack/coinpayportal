// DataFast Analytics Utility
// https://datafa.st

declare global {
  interface Window {
    datafast?: (event: string, data?: Record<string, any>) => void;
  }
}

/**
 * Track an event with DataFast analytics
 * @param event - Event name (e.g., 'initiate_checkout', 'page_view')
 * @param data - Optional event data
 */
export function trackEvent(event: string, data?: Record<string, any>): void {
  if (typeof window !== 'undefined' && window.datafast) {
    window.datafast(event, data);
  }
}

/**
 * Track checkout initiation
 */
export function trackCheckout(data: {
  name?: string;
  email?: string;
  product_id?: string;
  amount?: number;
  currency?: string;
}): void {
  trackEvent('initiate_checkout', data);
}

/**
 * Track payment completion
 */
export function trackPaymentComplete(data: {
  payment_id: string;
  amount: number;
  currency: string;
  crypto?: string;
}): void {
  trackEvent('payment_complete', data);
}

/**
 * Track signup
 */
export function trackSignup(data: {
  email?: string;
  method?: string;
}): void {
  trackEvent('signup', data);
}

/**
 * Track page view
 */
export function trackPageView(page: string): void {
  trackEvent('page_view', { page });
}

/**
 * Track button click
 */
export function trackClick(button: string, data?: Record<string, any>): void {
  trackEvent('click', { button, ...data });
}
export const formatAmount = (cents: number, currency: string = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

export const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export const statusColors: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-700',
  completed: 'bg-green-100 text-green-700',
  paid: 'bg-green-100 text-green-700',
  released: 'bg-green-100 text-green-700',
  enabled: 'bg-green-100 text-green-700',
  active: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  held: 'bg-yellow-100 text-yellow-700',
  funded: 'bg-yellow-100 text-yellow-700',
  in_transit: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
  disabled: 'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-gray-700',
  canceled: 'bg-gray-100 text-gray-700',
};

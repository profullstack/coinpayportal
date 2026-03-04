'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Business {
  id: string;
  name: string;
}

export default function CreateClientPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    business_id: '',
    email: '',
    name: '',
    company_name: '',
    phone: '',
    address: '',
    website: '',
  });

  useEffect(() => {
    const fetch = async () => {
      const result = await authFetch('/api/businesses', {}, router);
      if (result?.data.success) {
        setBusinesses(result.data.businesses);
        if (result.data.businesses.length === 1) {
          setForm(f => ({ ...f, business_id: result.data.businesses[0].id }));
        }
      }
      setLoading(false);
    };
    fetch();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const result = await authFetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }, router);

    if (result?.data.success) {
      router.push('/clients');
    } else {
      setError(result?.data.error || 'Failed to create client');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-lg mx-auto">
        <Link href="/clients" className="text-purple-400 hover:text-purple-300 text-sm mb-4 inline-block">← Back to Clients</Link>
        <h1 className="text-3xl font-bold text-white mb-8">Add Client</h1>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Business *</label>
            <select
              required
              value={form.business_id}
              onChange={e => setForm({ ...form, business_id: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            >
              <option value="">Select business</option>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Email *</label>
            <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" placeholder="client@example.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Name</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" placeholder="John Doe" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Company</label>
            <input type="text" value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" placeholder="Acme Corp" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Phone</label>
            <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Address</label>
            <textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" rows={2} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Website</label>
            <input type="url" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" placeholder="https://example.com" />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Link href="/clients" className="px-4 py-2 text-gray-400 hover:text-white">Cancel</Link>
            <button type="submit" disabled={saving}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg disabled:opacity-50">
              {saving ? 'Saving...' : 'Add Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

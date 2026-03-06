'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  currency: string;
  amount: string;
  crypto_currency: string | null;
  crypto_amount: string | null;
  due_date: string | null;
  created_at: string;
  clients: { id: string; name: string; email: string; company_name: string } | null;
  businesses: { id: string; name: string } | null;
}

interface Client {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  company_name: string | null;
  address: string | null;
  website: string | null;
  business_id: string;
  created_at: string;
}

interface Business {
  id: string;
  name: string;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-300',
  sent: 'bg-blue-500/20 text-blue-300',
  paid: 'bg-green-500/20 text-green-300',
  overdue: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-gray-500/20 text-gray-500',
};

// ─── Invoices Tab ────────────────────────────────────────────────
function InvoicesTab() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { fetchInvoices(); }, [statusFilter]);

  const fetchInvoices = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const result = await authFetch(`/api/invoices?${params.toString()}`, {}, router);
      if (!result) return;
      if (!result.response.ok || !result.data.success) {
        setError(result.data.error || 'Failed to load invoices');
      } else {
        setInvoices(result.data.invoices);
      }
    } catch {
      setError('Failed to load invoices');
    }
    setLoading(false);
  };

  const formatAmount = (amount: string, currency: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parseFloat(amount));

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400" /></div>;
  }

  return (
    <>
      {error && <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>}

      <div className="mb-6 flex gap-2 flex-wrap">
        {['', 'draft', 'sent', 'paid', 'overdue', 'cancelled'].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
      </div>

      {invoices.length === 0 ? (
        <div className="bg-gray-800/50 rounded-2xl p-12 text-center border border-gray-700">
          <svg className="mx-auto h-12 w-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-white">No invoices yet</h3>
          <p className="mt-2 text-gray-400">Create your first invoice to get started.</p>
          <Link href="/invoices/create" className="mt-4 inline-block px-4 py-2 bg-purple-600 text-white rounded-lg">Create Invoice</Link>
        </div>
      ) : (
        <div className="bg-gray-800/50 rounded-2xl border border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Invoice</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Due Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-gray-700/30 transition-colors">
                  <td className="px-6 py-4">
                    <Link href={`/invoices/${invoice.id}`} className="text-purple-400 hover:text-purple-300 font-medium">{invoice.invoice_number}</Link>
                    <p className="text-xs text-gray-500">{invoice.businesses?.name}</p>
                  </td>
                  <td className="px-6 py-4 text-gray-300">{invoice.clients?.company_name || invoice.clients?.name || invoice.clients?.email || '—'}</td>
                  <td className="px-6 py-4">
                    <span className="text-white font-medium">{formatAmount(invoice.amount, invoice.currency)}</span>
                    {invoice.crypto_currency && <p className="text-xs text-gray-500">{invoice.crypto_amount ? `${invoice.crypto_amount} ${invoice.crypto_currency}` : invoice.crypto_currency}</p>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${statusColors[invoice.status] || ''}`}>{invoice.status}</span>
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-sm">{invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : '—'}</td>
                  <td className="px-6 py-4">
                    <Link href={`/invoices/${invoice.id}`} className="text-sm text-purple-400 hover:text-purple-300">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── Clients Tab ─────────────────────────────────────────────────
function ClientsTab() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const emptyForm = { business_id: '', email: '', name: '', company_name: '', phone: '', address: '', website: '' };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    const [clientsRes, bizRes] = await Promise.all([
      authFetch('/api/clients', {}, router),
      authFetch('/api/businesses', {}, router),
    ]);
    if (clientsRes?.data.success) setClients(clientsRes.data.clients);
    if (bizRes?.data.success) {
      setBusinesses(bizRes.data.businesses);
      if (bizRes.data.businesses.length === 1) {
        setForm(f => ({ ...f, business_id: bizRes.data.businesses[0].id }));
      }
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this client? Invoices referencing this client will not be deleted.')) return;
    setDeleting(id);
    const result = await authFetch(`/api/clients/${id}`, { method: 'DELETE' }, router);
    if (result?.data.success) setClients(c => c.filter(cl => cl.id !== id));
    else setError(result?.data.error || 'Failed to delete');
    setDeleting(null);
  };

  const handleEdit = (client: Client) => {
    setEditing(client.id);
    setShowCreate(false);
    setForm({
      business_id: client.business_id,
      email: client.email,
      name: client.name || '',
      company_name: client.company_name || '',
      phone: client.phone || '',
      address: client.address || '',
      website: client.website || '',
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    if (editing) {
      const result = await authFetch(`/api/clients/${editing}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }, router);
      if (result?.data.success) {
        setClients(c => c.map(cl => cl.id === editing ? result.data.client : cl));
        setEditing(null);
        setForm(emptyForm);
      } else {
        setError(result?.data.error || 'Failed to update');
      }
    } else {
      const result = await authFetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }, router);
      if (result?.data.success) {
        setClients(c => [result.data.client, ...c]);
        setShowCreate(false);
        setForm(emptyForm);
      } else {
        setError(result?.data.error || 'Failed to create');
      }
    }
    setSaving(false);
  };

  const cancelForm = () => {
    setEditing(null);
    setShowCreate(false);
    setForm(emptyForm);
    setError('');
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400" /></div>;
  }

  const showForm = showCreate || editing;

  return (
    <>
      {error && <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>}

      {!showForm && (
        <div className="mb-6">
          <button onClick={() => { setShowCreate(true); setEditing(null); setForm({ ...emptyForm, business_id: businesses.length === 1 ? businesses[0].id : '' }); }}
            className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors">
            + Add Client
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSave} className="mb-6 bg-gray-800/50 rounded-2xl border border-gray-700 p-6 space-y-4">
          <h3 className="text-lg font-medium text-white">{editing ? 'Edit Client' : 'New Client'}</h3>
          {businesses.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Business *</label>
              <select required value={form.business_id} onChange={e => setForm({ ...form, business_id: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white">
                <option value="">Select business</option>
                {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Email *</label>
              <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" placeholder="client@example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" placeholder="John Doe" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Company</label>
              <input type="text" value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" placeholder="Acme Corp" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Address</label>
            <textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" rows={2} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Website</label>
            <input type="url" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" placeholder="https://example.com" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={cancelForm} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg disabled:opacity-50">
              {saving ? 'Saving...' : editing ? 'Update Client' : 'Add Client'}
            </button>
          </div>
        </form>
      )}

      {clients.length === 0 && !showForm ? (
        <div className="bg-gray-800/50 rounded-2xl p-12 text-center border border-gray-700">
          <h3 className="text-lg font-medium text-white">No clients yet</h3>
          <p className="mt-2 text-gray-400">Add your first client to start invoicing.</p>
        </div>
      ) : clients.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => (
            <div key={client.id} className={`bg-gray-800/50 rounded-xl border p-5 transition-colors ${editing === client.id ? 'border-purple-500' : 'border-gray-700 hover:border-gray-600'}`}>
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="text-white font-medium truncate">{client.company_name || client.name || 'Unnamed'}</h3>
                  <p className="text-gray-400 text-sm truncate">{client.email}</p>
                  {client.phone && <p className="text-gray-500 text-xs mt-1">{client.phone}</p>}
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <button onClick={() => handleEdit(client)} className="text-gray-500 hover:text-purple-400 text-sm" title="Edit">✏️</button>
                  <button onClick={() => handleDelete(client.id)} disabled={deleting === client.id}
                    className="text-gray-500 hover:text-red-400 text-sm" title="Delete">
                    {deleting === client.id ? '...' : '×'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-600 mt-3">Added {new Date(client.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Main Page with Tabs ─────────────────────────────────────────
export default function InvoicesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = searchParams.get('tab') === 'clients' ? 'clients' : 'invoices';
  const [activeTab, setActiveTab] = useState<'invoices' | 'clients'>(initialTab);

  const switchTab = (tab: 'invoices' | 'clients') => {
    setActiveTab(tab);
    const url = tab === 'clients' ? '/invoices?tab=clients' : '/invoices';
    router.replace(url, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {activeTab === 'invoices' ? 'Invoices' : 'Clients'}
            </h1>
            <p className="mt-2 text-gray-400">
              {activeTab === 'invoices' ? 'Create and manage crypto invoices' : 'Manage your invoice clients'}
            </p>
          </div>
          {activeTab === 'invoices' && (
            <Link href="/invoices/create"
              className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors">
              <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Invoice
            </Link>
          )}
        </div>

        {/* Tabs */}
        <div className="mb-6 flex border-b border-gray-700">
          <button onClick={() => switchTab('invoices')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'invoices' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
            Invoices
          </button>
          <button onClick={() => switchTab('clients')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'clients' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
            Clients
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'invoices' ? <InvoicesTab /> : <ClientsTab />}
      </div>
    </div>
  );
}

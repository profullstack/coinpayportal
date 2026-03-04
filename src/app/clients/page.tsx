'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/auth/client';

interface Client {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  company_name: string | null;
  business_id: string;
  created_at: string;
}

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => { fetchClients(); }, []);

  const fetchClients = async () => {
    const result = await authFetch('/api/clients', {}, router);
    if (!result) return;
    if (result.data.success) setClients(result.data.clients);
    else setError(result.data.error || 'Failed to load clients');
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this client?')) return;
    setDeleting(id);
    const result = await authFetch(`/api/clients/${id}`, { method: 'DELETE' }, router);
    if (result?.data.success) {
      setClients(c => c.filter(cl => cl.id !== id));
    } else {
      setError(result?.data.error || 'Failed to delete');
    }
    setDeleting(null);
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
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Clients</h1>
            <p className="mt-2 text-gray-400">Manage your invoice clients</p>
          </div>
          <Link
            href="/clients/create"
            className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + Add Client
          </Link>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>
        )}

        {clients.length === 0 ? (
          <div className="bg-gray-800/50 rounded-2xl p-12 text-center border border-gray-700">
            <h3 className="text-lg font-medium text-white">No clients yet</h3>
            <p className="mt-2 text-gray-400">Add your first client to start invoicing.</p>
            <Link href="/clients/create" className="mt-4 inline-block px-4 py-2 bg-purple-600 text-white rounded-lg">
              Add Client
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map(client => (
              <div key={client.id} className="bg-gray-800/50 rounded-xl border border-gray-700 p-5 hover:border-gray-600 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-white font-medium">{client.company_name || client.name || 'Unnamed'}</h3>
                    <p className="text-gray-400 text-sm">{client.email}</p>
                    {client.phone && <p className="text-gray-500 text-xs mt-1">{client.phone}</p>}
                  </div>
                  <button
                    onClick={() => handleDelete(client.id)}
                    disabled={deleting === client.id}
                    className="text-gray-500 hover:text-red-400 text-sm"
                  >
                    {deleting === client.id ? '...' : '×'}
                  </button>
                </div>
                <p className="text-xs text-gray-600 mt-3">Added {new Date(client.created_at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Business {
  id: string;
  name: string;
  description: string | null;
  webhook_url: string | null;
  created_at: string;
}

export default function BusinessesPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<Business | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchBusinesses();
  }, []);

  const fetchBusinesses = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/businesses', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to load businesses');
        setLoading(false);
        return;
      }

      setBusinesses(data.businesses);
      setLoading(false);
    } catch (err) {
      setError('Failed to load businesses');
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setFormData({
      name: '',
      description: '',
    });
    setEditingBusiness(null);
    setShowCreateModal(true);
  };

  const handleEdit = (business: Business) => {
    setFormData({
      name: business.name,
      description: business.description || '',
    });
    setEditingBusiness(business);
    setShowCreateModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/login');
        return;
      }

      const url = editingBusiness
        ? `/api/businesses/${editingBusiness.id}`
        : '/api/businesses';
      const method = editingBusiness ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to save business');
        setSaving(false);
        return;
      }

      setShowCreateModal(false);
      setSaving(false);
      fetchBusinesses();
    } catch (err) {
      setError('Failed to save business');
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this business?')) {
      return;
    }

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch(`/api/businesses/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to delete business');
        return;
      }

      fetchBusinesses();
    } catch (err) {
      setError('Failed to delete business');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading businesses...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Businesses</h1>
            <p className="mt-2 text-gray-600">
              Manage your businesses and payment settings
            </p>
          </div>
          <button
            onClick={handleCreate}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-500"
          >
            <svg
              className="h-5 w-5 mr-2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M12 4v16m8-8H4"></path>
            </svg>
            Create Business
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Businesses Grid */}
        {businesses.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">
              No businesses yet
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by creating your first business.
            </p>
            <div className="mt-6">
              <button
                onClick={handleCreate}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-500"
              >
                <svg
                  className="h-5 w-5 mr-2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M12 4v16m8-8H4"></path>
                </svg>
                Create Business
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {businesses.map((business) => (
              <div
                key={business.id}
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
              >
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {business.name}
                  </h3>
                  {business.description && (
                    <p className="text-sm text-gray-600 mb-4">
                      {business.description}
                    </p>
                  )}
                  <div className="space-y-2 text-sm">
                    <div className="text-xs text-gray-500">
                      Created {new Date(business.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 px-6 py-3 flex items-center justify-between border-t border-gray-200">
                  <button
                    onClick={() => router.push(`/businesses/${business.id}`)}
                    className="text-sm font-medium text-purple-600 hover:text-purple-500"
                  >
                    Manage
                  </button>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => handleEdit(business)}
                      className="text-sm font-medium text-gray-600 hover:text-gray-900"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(business.id)}
                      className="text-sm font-medium text-red-600 hover:text-red-500"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingBusiness ? 'Edit Business' : 'Create Business'}
                </h3>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Business Name *
                  </label>
                  <input
                    id="name"
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="My Business"
                  />
                </div>

                <div>
                  <label
                    htmlFor="description"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Description
                  </label>
                  <textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                    placeholder="Optional description"
                    rows={3}
                  />
                </div>

                <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
                  💡 After creating your business, you can configure wallet addresses and webhooks in the business management page.
                </p>

                <div className="flex items-center justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving
                      ? 'Saving...'
                      : editingBusiness
                      ? 'Update'
                      : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
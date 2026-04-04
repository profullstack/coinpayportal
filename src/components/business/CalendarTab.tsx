'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import {
  DayFlowCalendar,
  useCalendarApp,
  createEventsPlugin,
  createDayView,
  createWeekView,
  createMonthView,
  createYearView,
  createEvent,
  ViewType,
} from '@dayflow/react';
import { createDragPlugin } from '@dayflow/plugin-drag';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalendarTabProps {
  businessId: string;
}

interface CalendarEventRecord {
  id: string;
  business_id: string;
  user_id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  color: string;
  created_at: string;
  updated_at: string;
}

interface Escrow {
  id: string;
  chain: string;
  amount: number;
  amount_usd: number | null;
  status: string;
  created_at: string;
  expires_at: string | null;
}

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  due_date: string | null;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const ESCROW_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  deposited: '#f59e0b',
  released: '#22c55e',
  expired: '#ef4444',
  disputed: '#ef4444',
  refunded: '#6b7280',
};

const INVOICE_COLORS: Record<string, string> = {
  draft: '#6b7280',
  sent: '#3b82f6',
  viewed: '#3b82f6',
  paid: '#22c55e',
  overdue: '#ef4444',
  cancelled: '#6b7280',
};

const COLOR_OPTIONS = [
  '#8b5cf6',
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#6b7280',
];

// ---------------------------------------------------------------------------
// iCal export helper
// ---------------------------------------------------------------------------

function generateICalString(
  events: Array<{
    id: string;
    title: string;
    description?: string;
    start: Date;
    end: Date;
    allDay?: boolean;
  }>
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmtDate = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const fmtDateTime = (d: Date) =>
    `${fmtDate(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CoinPayPortal//Calendar//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@coinpayportal`);
    lines.push(`SUMMARY:${(ev.title || '').replace(/\n/g, '\\n')}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${ev.description.replace(/\n/g, '\\n')}`);
    }
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(ev.start)}`);
      lines.push(`DTEND;VALUE=DATE:${fmtDate(ev.end)}`);
    } else {
      lines.push(`DTSTART:${fmtDateTime(ev.start)}`);
      lines.push(`DTEND:${fmtDateTime(ev.end)}`);
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Add Event Modal
// ---------------------------------------------------------------------------

function AddEventModal({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    title: string;
    description: string;
    start_at: string;
    end_at: string;
    all_day: boolean;
    color: string;
  }) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [color, setColor] = useState('#8b5cf6');

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setStartAt('');
      setEndAt('');
      setAllDay(false);
      setColor('#8b5cf6');
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Add Calendar Event
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="Event title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="Optional description"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="all-day"
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
            />
            <label htmlFor="all-day" className="text-sm text-gray-700 dark:text-gray-300">
              All day
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Start *
              </label>
              <input
                type={allDay ? 'date' : 'datetime-local'}
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                End
              </label>
              <input
                type={allDay ? 'date' : 'datetime-local'}
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Color
            </label>
            <div className="flex gap-2 flex-wrap">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${
                    color === c ? 'border-white scale-110 ring-2 ring-purple-500' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !title || !startAt}
            onClick={() => {
              const start = allDay
                ? new Date(startAt + 'T00:00:00').toISOString()
                : new Date(startAt).toISOString();
              const end = endAt
                ? allDay
                  ? new Date(endAt + 'T23:59:59').toISOString()
                  : new Date(endAt).toISOString()
                : start;
              onSave({ title, description, start_at: start, end_at: end, all_day: allDay, color });
            }}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Event'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalendarTab
// ---------------------------------------------------------------------------

export function CalendarTab({ businessId }: CalendarTabProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Inject DayFlow CSS via <link> to avoid PostCSS @layer conflicts
  useEffect(() => {
    const id = 'dayflow-css';
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = '/css/dayflow.css';
      document.head.appendChild(link);
    }
  }, []);
  const [customEvents, setCustomEvents] = useState<CalendarEventRecord[]>([]);
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const fetchAll = useCallback(async () => {
    try {
      const [eventsRes, escrowsRes, invoicesRes] = await Promise.all([
        authFetch(`/api/businesses/${businessId}/calendar-events`, {}, router),
        authFetch(`/api/escrow?business_id=${businessId}`, {}, router),
        authFetch(`/api/invoices?business_id=${businessId}`, {}, router),
      ]);

      if (eventsRes?.data?.events) setCustomEvents(eventsRes.data.events);
      if (escrowsRes?.data?.escrows) setEscrows(escrowsRes.data.escrows);
      if (invoicesRes?.data?.invoices) setInvoices(invoicesRes.data.invoices);
    } catch {
      setError('Failed to load calendar data');
    }
  }, [businessId, router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchAll();
      setLoading(false);
    };
    load();
  }, [fetchAll]);

  // -------------------------------------------------------------------------
  // Convert data sources into DayFlow events
  // -------------------------------------------------------------------------

  const calendarEvents = useMemo(() => {
    const events: ReturnType<typeof createEvent>[] = [];

    // Custom events
    for (const ce of customEvents) {
      const start = new Date(ce.start_at);
      const end = ce.end_at ? new Date(ce.end_at) : new Date(start.getTime() + 3600000);
      events.push(
        createEvent({
          id: `custom-${ce.id}`,
          title: ce.title,
          description: ce.description || undefined,
          start,
          end,
          allDay: ce.all_day,
          calendarId: 'custom',
          meta: { type: 'custom', dbId: ce.id, color: ce.color },
        })
      );
    }

    // Escrows
    for (const esc of escrows) {
      const start = new Date(esc.created_at);
      const end = esc.expires_at ? new Date(esc.expires_at) : new Date(start.getTime() + 86400000);
      events.push(
        createEvent({
          id: `escrow-${esc.id}`,
          title: `Escrow: ${esc.amount} ${esc.chain}${esc.amount_usd ? ` ($${esc.amount_usd})` : ''}`,
          description: `Status: ${esc.status}`,
          start,
          end,
          calendarId: 'escrows',
          meta: { type: 'escrow', status: esc.status },
        })
      );
    }

    // Invoices
    for (const inv of invoices) {
      const start = new Date(inv.created_at);
      const end = inv.due_date ? new Date(inv.due_date) : new Date(start.getTime() + 86400000);
      events.push(
        createEvent({
          id: `invoice-${inv.id}`,
          title: `Invoice ${inv.invoice_number}: ${inv.total_amount} ${inv.currency}`,
          description: `Status: ${inv.status}`,
          start,
          end,
          calendarId: 'invoices',
          meta: { type: 'invoice', status: inv.status },
        })
      );
    }

    return events;
  }, [customEvents, escrows, invoices]);

  // -------------------------------------------------------------------------
  // Calendar configuration
  // -------------------------------------------------------------------------

  const calendarApp = useCalendarApp({
    views: [
      createDayView({ timeFormat: '12h' }),
      createWeekView({ timeFormat: '12h' }),
      createMonthView(),
      createYearView(),
    ],
    plugins: [
      createEventsPlugin(),
      createDragPlugin({
        enableDrag: true,
        enableResize: true,
        enableCreate: false,
      }),
    ],
    events: calendarEvents,
    defaultView: ViewType.MONTH,
    theme: { mode: 'dark' },
    calendars: [
      {
        id: 'custom',
        name: 'Custom Events',
        colors: {
          eventColor: '#8b5cf6',
          eventSelectedColor: '#7c3aed',
          lineColor: '#8b5cf6',
          textColor: '#ffffff',
        },
        darkColors: {
          eventColor: '#8b5cf6',
          eventSelectedColor: '#7c3aed',
          lineColor: '#8b5cf6',
          textColor: '#ffffff',
        },
      },
      {
        id: 'escrows',
        name: 'Escrows',
        colors: {
          eventColor: '#f59e0b',
          eventSelectedColor: '#d97706',
          lineColor: '#f59e0b',
          textColor: '#ffffff',
        },
        darkColors: {
          eventColor: '#f59e0b',
          eventSelectedColor: '#d97706',
          lineColor: '#f59e0b',
          textColor: '#ffffff',
        },
      },
      {
        id: 'invoices',
        name: 'Invoices',
        colors: {
          eventColor: '#3b82f6',
          eventSelectedColor: '#2563eb',
          lineColor: '#3b82f6',
          textColor: '#ffffff',
        },
        darkColors: {
          eventColor: '#3b82f6',
          eventSelectedColor: '#2563eb',
          lineColor: '#3b82f6',
          textColor: '#ffffff',
        },
      },
    ],
    callbacks: {
      onEventUpdate: async (event) => {
        // Handle drag-and-drop reschedule for custom events
        const meta = event.meta as { type?: string; dbId?: string } | undefined;
        if (meta?.type !== 'custom' || !meta.dbId) return;

        try {
          const startDate = temporalToDate(event.start);
          const endDate = temporalToDate(event.end);
          await authFetch(
            `/api/businesses/${businessId}/calendar-events/${meta.dbId}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                start_at: startDate.toISOString(),
                end_at: endDate.toISOString(),
              }),
            },
            router
          );
        } catch {
          // Silently fail — the visual state will be stale, user can refresh
        }
      },
    },
  });

  // Sync events when they change
  useEffect(() => {
    if (calendarEvents.length > 0 || !loading) {
      calendarApp.app.updateConfig({ events: calendarEvents });
    }
  }, [calendarEvents, loading, calendarApp.app]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleAddEvent = useCallback(
    async (data: {
      title: string;
      description: string;
      start_at: string;
      end_at: string;
      all_day: boolean;
      color: string;
    }) => {
      setSaving(true);
      setError('');
      try {
        const result = await authFetch(
          `/api/businesses/${businessId}/calendar-events`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          },
          router
        );
        if (result?.data?.success) {
          setModalOpen(false);
          await fetchAll();
        } else {
          setError(result?.data?.error || 'Failed to create event');
        }
      } catch {
        setError('Failed to create event');
      } finally {
        setSaving(false);
      }
    },
    [businessId, router, fetchAll]
  );

  const handleExportICal = useCallback(() => {
    const allEvents: Array<{
      id: string;
      title: string;
      description?: string;
      start: Date;
      end: Date;
      allDay?: boolean;
    }> = [];

    for (const ce of customEvents) {
      allEvents.push({
        id: ce.id,
        title: ce.title,
        description: ce.description || undefined,
        start: new Date(ce.start_at),
        end: ce.end_at ? new Date(ce.end_at) : new Date(ce.start_at),
        allDay: ce.all_day,
      });
    }
    for (const esc of escrows) {
      allEvents.push({
        id: `escrow-${esc.id}`,
        title: `Escrow: ${esc.amount} ${esc.chain}`,
        description: `Status: ${esc.status}`,
        start: new Date(esc.created_at),
        end: esc.expires_at ? new Date(esc.expires_at) : new Date(esc.created_at),
      });
    }
    for (const inv of invoices) {
      allEvents.push({
        id: `invoice-${inv.id}`,
        title: `Invoice ${inv.invoice_number}: ${inv.total_amount} ${inv.currency}`,
        description: `Status: ${inv.status}`,
        start: new Date(inv.created_at),
        end: inv.due_date ? new Date(inv.due_date) : new Date(inv.created_at),
      });
    }

    const ical = generateICalString(allEvents);
    const blob = new Blob([ical], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `business-calendar-${new Date().toISOString().slice(0, 10)}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }, [customEvents, escrows, invoices]);

  const handleGoogleCalendar = useCallback(() => {
    // TODO: Implement full OAuth flow once GOOGLE_CALENDAR_CLIENT_ID is configured
    alert(
      'Google Calendar sync requires OAuth configuration.\n\n' +
        'Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET\n' +
        'environment variables to enable this feature.'
    );
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto" />
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading calendar...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Calendar</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            View escrows, invoices, and custom events in one place.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setModalOpen(true)}
            className="px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            + Add Event
          </button>
          <button
            onClick={handleExportICal}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Export iCal
          </button>
          <button
            onClick={handleGoogleCalendar}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Connect Google
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-purple-500 inline-block" />
          Custom Events
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
          Escrows
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
          Invoices
        </span>
      </div>

      {/* Calendar */}
      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700" style={{ height: '650px' }}>
        <DayFlowCalendar calendar={calendarApp} />
      </div>

      <AddEventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleAddEvent}
        saving={saving}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Temporal → Date helper
// ---------------------------------------------------------------------------

function temporalToDate(temporal: unknown): Date {
  if (temporal instanceof Date) return temporal;
  // Temporal.PlainDateTime / PlainDate / ZonedDateTime all have toString()
  const str = String(temporal);
  return new Date(str);
}

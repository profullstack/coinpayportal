/**
 * Projects, time tracking, AR aging, invoice settings and client portal links.
 *
 * An API key is locked to its own business, so `businessId` is optional when
 * the client was created with one.
 */

const q = (params) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
};
const json = (method, body) => ({ method, body: JSON.stringify(body) });

/** Open invoices by days past due, per currency and per client. */
export async function getArAging(client, { businessId } = {}) {
  return client.request('/invoices/aging' + q({ business_id: businessId }));
}

/** Reminder schedule, late fee and branding. */
export async function getInvoiceSettings(client, { businessId } = {}) {
  const data = await client.request('/invoice-settings' + q({ business_id: businessId }));
  return data.settings;
}

/**
 * Update invoice settings. Fields use the API's names: reminders_enabled,
 * reminder_days (e.g. [-3, 0, 7]), late_fee_type ('none'|'percent'|'fixed'),
 * late_fee_value, late_fee_after_days, brand_color, logo_url, invoice_footer.
 */
export async function updateInvoiceSettings(client, { businessId, ...fields }) {
  const data = await client.request('/invoice-settings', json('PUT', { business_id: businessId, ...fields }));
  return data.settings;
}

/** Create (or replace) a client's portal link; the old one stops working. */
export async function createClientPortalLink(client, clientId) {
  const data = await client.request(`/clients/${encodeURIComponent(clientId)}/portal-link`, { method: 'POST' });
  return data.url;
}

export async function revokeClientPortalLink(client, clientId) {
  return client.request(`/clients/${encodeURIComponent(clientId)}/portal-link`, { method: 'DELETE' });
}

export async function listProjects(client, { businessId, includeArchived } = {}) {
  const data = await client.request('/projects' + q({ business_id: businessId, include_archived: includeArchived ? 'true' : undefined }));
  return data.projects ?? [];
}

/** A project with its hours, unbilled, billed and paid totals. */
export async function getProject(client, id) {
  return client.request('/projects/' + encodeURIComponent(id));
}

export async function createProject(client, { businessId, name, clientId, hourlyRate, currency, budgetHours, notes }) {
  const body = { name };
  if (businessId) body.business_id = businessId;
  if (clientId) body.client_id = clientId;
  if (hourlyRate !== undefined) body.hourly_rate = hourlyRate;
  if (currency) body.currency = currency;
  if (budgetHours !== undefined) body.budget_hours = budgetHours;
  if (notes) body.notes = notes;
  const data = await client.request('/projects', json('POST', body));
  return data.project;
}

/** Log finished time on a project. */
export async function logTime(client, { projectId, minutes, description, billable, hourlyRate, startedAt }) {
  const body = { project_id: projectId, minutes };
  if (description) body.description = description;
  if (billable !== undefined) body.billable = billable;
  if (hourlyRate !== undefined) body.hourly_rate = hourlyRate;
  if (startedAt) body.started_at = startedAt;
  const data = await client.request('/time-entries', json('POST', body));
  return data.time_entry;
}

/** Start a running timer (one per person). */
export async function startTimer(client, { projectId, description }) {
  const data = await client.request('/time-entries', json('POST', { project_id: projectId, start: true, ...(description ? { description } : {}) }));
  return data.time_entry;
}

/** Stop a running timer; with no id, stops yours wherever it runs. */
export async function stopTimer(client, { entryId, businessId } = {}) {
  let id = entryId;
  if (!id) {
    const data = await client.request('/time-entries' + q({ business_id: businessId, running: 'true' }));
    id = data.time_entries?.[0]?.id;
    if (!id) throw new Error('No timer is running');
  }
  const data = await client.request('/time-entries/' + encodeURIComponent(id), json('PATCH', { stop: true }));
  return data.time_entry;
}

export async function listTimeEntries(client, { projectId, businessId, unbilled } = {}) {
  const data = await client.request(
    '/time-entries' + q({ project_id: projectId, business_id: businessId, unbilled: unbilled ? 'true' : undefined })
  );
  return data.time_entries ?? [];
}

/** Bill a project's unbilled billable time as a draft itemised invoice. */
export async function invoiceProjectTime(client, projectId, { entryIds } = {}) {
  return client.request(`/projects/${encodeURIComponent(projectId)}/invoice`, json('POST', entryIds ? { entry_ids: entryIds } : {}));
}

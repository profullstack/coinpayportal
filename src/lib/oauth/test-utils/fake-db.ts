/**
 * A tiny in-memory stand-in for the supabase-js query builder, enough for the
 * OAuth routes: from().select/insert/update/upsert/delete with eq/in filters
 * and single/maybeSingle/await terminals. Test-only.
 */
import { randomUUID } from 'crypto';

type Row = Record<string, any>;

/** Column defaults the real schema applies on insert. */
const DEFAULTS: Record<string, Row> = {
  oauth_refresh_tokens: { revoked: false },
  oauth_authorization_codes: { used: false },
  oauth_device_codes: { status: 'pending', interval_seconds: 5 },
};

export class FakeDb {
  tables: Record<string, Row[]> = {};
  /** Make the next query on a table fail with this message. */
  failNext: Record<string, string> = {};

  rows(table: string): Row[] {
    return (this.tables[table] ||= []);
  }

  seed(table: string, rows: Row[]) {
    for (const r of rows) this.rows(table).push({ id: r.id ?? randomUUID(), ...r });
  }

  from(table: string) {
    return new Query(this, table);
  }
}

class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any;
  private onConflict?: string;
  private returning = false;

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string) {
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }) {
    this.op = 'upsert';
    this.payload = row;
    this.onConflict = opts?.onConflict;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: any[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order() {
    return this;
  }

  private run(): { data: any; error: any } {
    const fail = this.db.failNext[this.table];
    if (fail) {
      delete this.db.failNext[this.table];
      return { data: null, error: { message: fail } };
    }
    const all = this.db.rows(this.table);
    const match = (r: Row) => this.filters.every((f) => f(r));
    switch (this.op) {
      case 'select':
        return { data: all.filter(match).map((r) => ({ ...r })), error: null };
      case 'insert': {
        const out: Row[] = [];
        for (const r of this.payload as Row[]) {
          const row: Row = { id: randomUUID(), ...(DEFAULTS[this.table] || {}), ...r };
          for (const key of ['code', 'token', 'device_code', 'user_code', 'client_id']) {
            if (key === 'client_id' && this.table !== 'oauth_clients') continue;
            if (row[key] !== undefined && all.some((x) => x[key] === row[key])) {
              return { data: null, error: { message: `duplicate ${key}`, code: '23505' } };
            }
          }
          all.push(row);
          out.push({ ...row });
        }
        return { data: this.returning ? out : null, error: null };
      }
      case 'update': {
        const hit = all.filter(match);
        for (const r of hit) Object.assign(r, this.payload);
        return { data: this.returning ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      case 'upsert': {
        const keys = (this.onConflict || 'id').split(',');
        const existing = all.find((r) => keys.every((k) => r[k] === this.payload[k]));
        if (existing) Object.assign(existing, this.payload);
        else all.push({ id: this.payload.id ?? randomUUID(), ...this.payload });
        return { data: null, error: null };
      }
      case 'delete': {
        const keep = all.filter((r) => !match(r));
        this.db.tables[this.table] = keep;
        return { data: null, error: null };
      }
    }
  }

  async single() {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : [];
    if (rows.length !== 1) return { data: null, error: { message: 'not exactly one row' } };
    return { data: rows[0], error: null };
  }
  async maybeSingle() {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : [];
    if (rows.length > 1) return { data: null, error: { message: 'more than one row' } };
    return { data: rows[0] ?? null, error: null };
  }
  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    try {
      return Promise.resolve(this.run()).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  }
}

import { HttpError } from "../../supabase/functions/_shared/errors.ts";

/**
 * The two boundaries `client-mail` cannot be run without — Clerk's session
 * check and Postgres — faked so the real handler can be exercised end to end.
 *
 * Everything between them is shipped code: the handler, `_shared/mail.ts`
 * (composition, subjects, the schedule mirror) and the SMTP settings reader.
 * The socket itself is the third boundary and is mocked in the test file,
 * because a test run must not open a connection to a mail server.
 *
 * The query builder answers exactly the chain the handler uses — `select` with
 * `eq` / `in` / `lte` / `order` / `limit`, `insert`, `update().eq()`,
 * `maybeSingle()` — and, unlike the contacts fake, returns *arrays* for an
 * awaited select, because this handler reads whole batches of customers.
 */

export type Row = Record<string, any>;

export interface FakeDb {
  businesses: Row[];
  clients: Row[];
  mail_accounts: Row[];
  sent_messages: Row[];
}

export function emptyDb(): FakeDb {
  return { businesses: [], clients: [], mail_accounts: [], sent_messages: [] };
}

type Filter = (row: Row) => boolean;

class FakeQuery {
  private filters: Filter[] = [];
  private action: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] | null = null;
  private ordered: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private single = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_columns?: unknown): this {
    return this;
  }

  insert(row: Row | Row[]): this {
    this.action = "insert";
    this.payload = row;
    return this;
  }

  update(row: Row): this {
    this.action = "update";
    this.payload = row;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  /** ISO timestamps compare correctly as strings, which is all this needs. */
  lte(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column] ?? "") <= String(value));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.ordered = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number): this {
    this.limitN = count;
    return this;
  }

  maybeSingle() {
    this.single = true;
    return this;
  }

  single() {
    this.single = true;
    return this;
  }

  /** Awaiting the builder directly — every read and write does this. */
  then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
    return this.run().then(resolve, reject);
  }

  private rows(): Row[] {
    const store = this.db as unknown as Record<string, Row[]>;
    const table = store[this.table] ?? [];
    return table.filter((row) => this.filters.every((filter) => filter(row)));
  }

  private async run(): Promise<{ data: any; error: any }> {
    const store = this.db as unknown as Record<string, Row[]>;

    if (this.action === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      for (const row of rows) {
        store[this.table].push({
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          ...row,
        });
      }
      return { data: rows, error: null };
    }

    if (this.action === "update") {
      for (const row of this.rows()) Object.assign(row, this.payload);
      return { data: null, error: null };
    }

    let matched = this.rows();
    if (this.ordered) {
      const { column, ascending } = this.ordered;
      matched = [...matched].sort((a, b) =>
        ascending
          ? String(a[column] ?? "").localeCompare(String(b[column] ?? ""))
          : String(b[column] ?? "").localeCompare(String(a[column] ?? "")),
      );
    }
    if (this.limitN !== null) matched = matched.slice(0, this.limitN);

    return { data: this.single ? (matched[0] ?? null) : matched, error: null };
  }
}

/* ------------------------------------------------------------- injected state */

export const state: {
  /** The caller Clerk would have identified, or null when no session was sent. */
  userId: string | null;
  db: FakeDb;
} = { userId: "user-a", db: emptyDb() };

/** The service-role client, as far as the handler is concerned. */
export function adminClient() {
  const db = state.db;
  return {
    from: (table: string) => new FakeQuery(db, table),
  } as any;
}

/**
 * The identity check, with the JWKS fetch removed: presence of a bearer token
 * stands in for a verified one, and `state.userId` is who it belongs to.
 */
export async function requireCaller(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.replace(/^Bearer\s+/i, "").trim()) {
    throw new HttpError(401, "Missing bearer token.");
  }
  if (!state.userId) throw new HttpError(401, "Invalid or expired session token.");
  return { userId: state.userId };
}

/** The tenant check, against the seeded businesses instead of the real table. */
export async function assertBusinessOwned(callerUserId: string, businessId: string) {
  if (!businessId) throw new HttpError(400, "A business id is required.");
  const row = state.db.businesses.find((business) => business.id === businessId);
  if (!row || row.owner_user_id !== callerUserId) {
    throw new HttpError(403, "You do not have access to this business.");
  }
  return { id: businessId, owner_user_id: callerUserId };
}

/* ------------------------------------------------------------------- seeding */

export function seedBusiness(id = "biz-1", ownerUserId = "user-a"): Row {
  const row: Row = { id, owner_user_id: ownerUserId, brand_name: "GlowMart Beauty" };
  state.db.businesses.push(row);
  return row;
}

let clientSeq = 0;

export function seedClient(overrides: Row = {}): Row {
  clientSeq += 1;
  const row: Row = {
    id: `client-${clientSeq}`,
    business_id: "biz-1",
    name: `Ada Lovelace ${clientSeq}`,
    company: "GlowMart Beauty",
    email: `ada${clientSeq}@example.com`,
    message_types: ["deals"],
    frequency: "weekly",
    status: "active",
    next_send_at: "2026-09-01T08:00:00.000Z",
    last_contacted_at: null,
    ...overrides,
  };
  state.db.clients.push(row);
  return row;
}

export function seedMailAccount(overrides: Row = {}): Row {
  const row: Row = {
    id: "mail-1",
    business_id: "biz-1",
    sender_name: "Aurora",
    reply_to: "hello@glowmart.example",
    signature: "Stay sharp,\nAurora",
    ...overrides,
  };
  state.db.mail_accounts.push(row);
  return row;
}

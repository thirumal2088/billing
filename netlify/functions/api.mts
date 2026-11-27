// Rainbow Sports Billing — secure shared API (Netlify Functions + Netlify Database + Netlify Blobs)
import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const db = getDatabase();
const files = () => getStore({ name: "bill-attachments", consistency: "strong" });

const SESSION_COOKIE = "rs_session";
const SESSION_DAYS = 30;
const MAX_JSON = 5 * 1024 * 1024;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_FILES_PER_BILL = 30;
const MAX_BILL_BYTES = 512 * 1024;
const WRITE_LOCK = 72421; // serialises writes: invoice numbers, rack checks, change order
const RACK_CAPACITY = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_MIME = /^(image\/(jpeg|png|webp)|audio\/[a-z0-9.+-]+|text\/csv|application\/(vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|octet-stream))$/i;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Staff = { id: number; name: string; mobile: string; role: "admin" | "staff" };
type Client = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>; release: () => void };

// ---------- helpers ----------
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

const q = (text: string, params: unknown[] = []) => db.pool.query(text, params) as Promise<{ rows: any[] }>;

async function transaction<T>(work: (c: Client) => Promise<T>): Promise<T> {
  const client = (await db.pool.connect()) as unknown as Client;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function normaliseMobile(value: unknown): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^\d{10}$/.test(digits)) throw new HttpError(400, "Enter a valid 10-digit mobile number.");
  return digits;
}

function checkPassword(password: unknown): string {
  const value = String(password ?? "");
  if (value.length < 8 || value.length > 128) throw new HttpError(400, "Password must be 8 to 128 characters.");
  return value;
}

function checkName(name: unknown): string {
  const value = String(name ?? "").trim();
  if (!value || value.length > 80) throw new HttpError(400, "Enter the staff member's name.");
  return value;
}

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 16384, 8, 1);
  return `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), Number(N), Number(r), Number(p));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sessionCookie(token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function currentStaff(req: Request): Promise<Staff | null> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const { rows } = await q(
    `SELECT s.id, s.name, s.mobile, s.role FROM sessions x JOIN staff s ON s.id = x.staff_id
     WHERE x.token_hash = $1 AND x.expires_at > NOW() AND s.active`,
    [sha256(token)],
  );
  return rows[0] || null;
}

async function requireStaff(req: Request): Promise<Staff> {
  const staff = await currentStaff(req);
  if (!staff) throw new HttpError(401, "Please sign in again.");
  return staff;
}

async function requireAdmin(req: Request): Promise<Staff> {
  const staff = await requireStaff(req);
  if (staff.role !== "admin") throw new HttpError(400, "Only an admin can manage staff.");
  return staff;
}

async function readJson(req: Request): Promise<any> {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > MAX_JSON) throw new HttpError(413, "Request is too large.");
  const text = await req.text();
  if (text.length > MAX_JSON) throw new HttpError(413, "Request is too large.");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "Invalid request data.");
  }
}

async function createSession(staffId: number) {
  const token = randomBytes(32).toString("base64url");
  await q(`DELETE FROM sessions WHERE expires_at < NOW()`);
  await q(`INSERT INTO sessions (token_hash, staff_id, expires_at) VALUES ($1, $2, NOW() + ($3 || ' days')::interval)`, [
    sha256(token),
    staffId,
    String(SESSION_DAYS),
  ]);
  return sessionCookie(token, SESSION_DAYS * 86400);
}

// ---------- bills ----------
const prefixFor = (type: string) => (type === "order" ? "RS" : "DS");

function rackSlot(value: unknown): number {
  const match = /^(?:(?:rack|r)\s*[-#]?\s*)?(\d+)$/i.exec(String(value ?? "").trim());
  const number = match ? Number(match[1]) : 0;
  return number >= 1 && number <= RACK_CAPACITY ? number : 0;
}

function cleanBill(input: any): any {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Invalid bill data.");
  const bill = { ...input };
  delete bill.sequence;
  delete bill.version;
  if (typeof bill.id !== "string" || !UUID_RE.test(bill.id)) throw new HttpError(400, "Invalid bill ID.");
  bill.id = bill.id.toLowerCase();
  if (!["order", "direct"].includes(bill.type)) throw new HttpError(400, "Invalid bill type.");
  if (!Array.isArray(bill.items)) bill.items = [];
  if (!Array.isArray(bill.payments)) bill.payments = [];
  if (!Array.isArray(bill.stages)) bill.stages = [];
  for (const key of ["total", "subtotal", "tax"]) bill[key] = Number(bill[key]) || 0;
  for (const p of bill.payments) {
    if (!p || typeof p !== "object" || !Number.isFinite(Number(p.amount))) throw new HttpError(400, "Invalid payment entry.");
    p.amount = Number(p.amount);
  }
  if (bill.type === "order" && bill.status === "Delivered") {
    delete bill.rackNo;
    delete bill.lastRackNo;
  }
  if (JSON.stringify(bill).length > MAX_BILL_BYTES) throw new HttpError(413, "This bill is too large to save.");
  return bill;
}

async function nextInvoiceNumber(c: Client, type: string): Promise<string> {
  const prefix = prefixFor(type);
  const { rows } = await c.query(
    `SELECT COALESCE(MAX((substring(no from $1))::int), 0) AS n FROM bills WHERE no ~ $2`,
    [`^${prefix}-(\\d+)$`, `^${prefix}-\\d+$`],
  );
  return `${prefix}-${String(Number(rows[0].n) + 1).padStart(4, "0")}`;
}

async function rackTaken(c: Client, bill: any): Promise<boolean> {
  const slot = rackSlot(bill.rackNo);
  if (bill.type !== "order" || bill.status === "Delivered" || !slot) return false;
  const { rows } = await c.query(
    `SELECT body->>'rackNo' AS rack FROM bills
     WHERE id <> $1 AND type = 'order' AND COALESCE(body->>'status','') <> 'Delivered'
       AND COALESCE(body->>'rackNo','') <> ''`,
    [bill.id],
  );
  return rows.some((row) => rackSlot(row.rack) === slot);
}

// Key order independent JSON (Postgres JSONB reorders object keys)
function stable(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}

const billRow = (row: any) => ({ bill: row.body, version: row.version, sequence: Number(row.sequence) });

async function saveBills(staff: Staff, changes: any[]) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 200) throw new HttpError(400, "Invalid bill changes.");
  return transaction(async (c) => {
    const saved: any[] = [];
    for (const change of changes) {
      const bill = cleanBill(change?.bill);
      const version = change?.version ?? null;
      const { rows } = await c.query(`SELECT body, version, no, type FROM bills WHERE id = $1 FOR UPDATE`, [bill.id]);
      const existing = rows[0];
      if (existing && version === null) {
        // A retried "create" with the same ID keeps the bill already stored.
        const { rows: again } = await c.query(`SELECT body, version, sequence FROM bills WHERE id = $1`, [bill.id]);
        saved.push(billRow(again[0]));
        continue;
      }
      if (!existing && version !== null) throw new HttpError(409, "This bill is no longer available. The list has been refreshed.");
      if (existing) {
        if (Number(version) !== existing.version)
          throw new HttpError(409, `Another staff member just updated ${existing.no}. The latest copy has been loaded — please make your change again.`);
        bill.no = existing.no;
        bill.type = existing.type;
        const oldPayments = Array.isArray(existing.body.payments) ? existing.body.payments : [];
        const kept = oldPayments.every((p: any, i: number) => stable(p) === stable(bill.payments[i]));
        if (!kept) throw new HttpError(400, "Existing payment entries cannot be removed or changed.");
      } else {
        bill.no = await nextInvoiceNumber(c, bill.type);
      }
      if (await rackTaken(c, bill)) throw new HttpError(409, `Rack ${rackSlot(bill.rackNo)} is already occupied by another order. Choose another rack.`);
      const result = existing
        ? await c.query(
            `UPDATE bills SET body = $2::jsonb, version = version + 1, change_seq = nextval('change_seq'), updated_by = $3, updated_at = NOW()
             WHERE id = $1 RETURNING body, version, sequence`,
            [bill.id, JSON.stringify(bill), staff.id],
          )
        : await c.query(
            `INSERT INTO bills (id, no, type, body, created_by, updated_by) VALUES ($1, $2, $3, $4::jsonb, $5, $5)
             RETURNING body, version, sequence`,
            [bill.id, bill.no, bill.type, JSON.stringify(bill), staff.id],
          );
      saved.push(billRow(result.rows[0]));
    }
    return saved;
  });
}

// ---------- backup import with duplicate protection ----------
function legacyId(raw: any): string {
  if (typeof raw?.id === "string" && UUID_RE.test(raw.id)) return raw.id.toLowerCase();
  const h = sha256("rainbow-import:" + String(raw?.id ?? "") + ":" + String(raw?.no ?? "") + ":" + String(raw?.date ?? "") + ":" + String(raw?.customer ?? ""));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function fingerprint(bill: any): string {
  return JSON.stringify([
    String(bill.customer ?? "").trim().toLowerCase(),
    String(bill.mobile ?? "").replace(/\D/g, "").slice(-10),
    String(bill.date ?? ""),
    Math.round((Number(bill.total) || 0) * 100),
    (Array.isArray(bill.items) ? bill.items : []).map((i: any) => [String(i?.desc ?? "").trim().toLowerCase(), Number(i?.qty) || 0, Number(i?.rate) || 0]),
  ]);
}

async function importBills(staff: Staff, body: any) {
  const incoming = body?.bills;
  if (!Array.isArray(incoming) || incoming.length > 500) throw new HttpError(400, "Send up to 500 bills per import batch.");
  const commit = body?.commit === true;
  const renumber = body?.renumberConflicts === true;
  const report = { added: 0, duplicates: 0, conflicts: 0, renumbered: 0, invalid: 0, racksCleared: 0, addedIds: [] as string[], existingIds: [] as string[], conflictNumbers: [] as string[] };

  const run = async (c: Client) => {
    const seenIds = new Set<string>();
    for (const raw of incoming) {
      let bill: any;
      try {
        bill = cleanBill({ ...raw, id: legacyId(raw) });
      } catch {
        report.invalid++;
        continue;
      }
      if (seenIds.has(bill.id)) {
        report.duplicates++;
        continue;
      }
      seenIds.add(bill.id);
      const { rows: byId } = await c.query(`SELECT 1 FROM bills WHERE id = $1`, [bill.id]);
      if (byId.length) {
        report.duplicates++;
        report.existingIds.push(bill.id);
        continue;
      }
      const no = typeof bill.no === "string" ? bill.no.trim().slice(0, 40) : "";
      if (no) {
        const { rows: byNo } = await c.query(`SELECT body FROM bills WHERE no = $1`, [no]);
        if (byNo.length) {
          if (fingerprint(byNo[0].body) === fingerprint(bill)) {
            report.duplicates++;
            continue;
          }
          report.conflicts++;
          report.conflictNumbers.push(no);
          if (!renumber) continue;
          bill.originalNo = no;
          bill.no = await nextInvoiceNumber(c, bill.type);
          report.renumbered++;
        } else bill.no = no;
      } else bill.no = await nextInvoiceNumber(c, bill.type);
      if (await rackTaken(c, bill)) {
        bill.rackNo = "";
        report.racksCleared++;
      }
      await c.query(
        `INSERT INTO bills (id, no, type, body, created_by, updated_by, imported) VALUES ($1, $2, $3, $4::jsonb, $5, $5, TRUE)`,
        [bill.id, bill.no, bill.type, JSON.stringify(bill), staff.id],
      );
      report.added++;
      report.addedIds.push(bill.id);
    }
  };

  // A dry run uses the same rules inside a transaction that is always rolled back.
  await transaction(async (c) => {
    await run(c);
    if (!commit) throw new DryRunDone();
  }).catch((error) => {
    if (!(error instanceof DryRunDone)) throw error;
  });
  return { ...report, committed: commit };
}
class DryRunDone extends Error {}

// ---------- attachments ----------
async function uploadAttachment(staff: Staff, req: Request, url: URL) {
  const id = String(url.searchParams.get("id") || "").toLowerCase();
  const billId = String(url.searchParams.get("bill") || "").toLowerCase();
  const kind = String(url.searchParams.get("kind") || "");
  const name = String(url.searchParams.get("name") || "file").replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 160) || "file";
  if (!UUID_RE.test(id) || !UUID_RE.test(billId) || !["image", "excel", "audio"].includes(kind)) throw new HttpError(400, "Invalid attachment.");
  const { rows: bill } = await q(`SELECT 1 FROM bills WHERE id = $1`, [billId]);
  if (!bill.length) throw new HttpError(404, "Save the bill before adding attachments.");
  const { rows: existing } = await q(`SELECT id FROM attachments WHERE id = $1`, [id]);
  if (existing.length) return json({ ok: true, duplicate: true });
  const { rows: count } = await q(`SELECT COUNT(*)::int AS n FROM attachments WHERE bill_id = $1`, [billId]);
  if (count[0].n >= MAX_FILES_PER_BILL) throw new HttpError(400, `A bill can have up to ${MAX_FILES_PER_BILL} attachments.`);
  if (Number(req.headers.get("content-length") || 0) > MAX_FILE) throw new HttpError(413, "Each attachment must be 4 MB or smaller.");
  const data = await req.arrayBuffer();
  if (!data.byteLength) throw new HttpError(400, "The file is empty.");
  if (data.byteLength > MAX_FILE) throw new HttpError(413, "Each attachment must be 4 MB or smaller.");
  const type = (req.headers.get("content-type") || "").split(";")[0].trim();
  const mime = SAFE_MIME.test(type) ? type : "application/octet-stream";
  await files().set(id, data, { metadata: { billId, mime } });
  await q(
    `INSERT INTO attachments (id, bill_id, name, kind, mime, size, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
    [id, billId, name, kind, mime, data.byteLength, staff.id],
  );
  return json({ ok: true });
}

// ---------- router ----------
async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method;

  if (method !== "GET" && method !== "HEAD") {
    // CSRF protection: the app always sends this header; browsers block it cross-site without CORS.
    if (req.headers.get("x-rainbow-client") !== "1") throw new HttpError(400, "Request blocked.");
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== url.host) throw new HttpError(400, "Request blocked.");
  }

  // --- auth ---
  if (path === "/api/auth/status" && method === "GET") {
    const staff = await currentStaff(req);
    const { rows } = await q(`SELECT EXISTS (SELECT 1 FROM staff WHERE role = 'admin') AS has_admin`);
    return json({ user: staff, needsSetup: !rows[0].has_admin });
  }

  if (path === "/api/auth/setup" && method === "POST") {
    const body = await readJson(req);
    const setupKey = process.env.RAINBOW_SETUP_KEY || "";
    const given = String(body.setupKey || "");
    if (setupKey.length < 8) throw new HttpError(400, "First-time setup is not enabled yet. Add the RAINBOW_SETUP_KEY environment variable in Netlify and redeploy.");
    const keyOk = setupKey.length >= 8 && given.length === setupKey.length && timingSafeEqual(Buffer.from(given), Buffer.from(setupKey));
    if (!keyOk) throw new HttpError(401, "The setup key is not correct.");
    const name = checkName(body.name);
    const mobile = normaliseMobile(body.mobile);
    const hash = await hashPassword(checkPassword(body.password));
    const id = await transaction(async (c) => {
      const { rows } = await c.query(`SELECT 1 FROM staff WHERE role = 'admin'`);
      if (rows.length) throw new HttpError(409, "An admin account already exists. Please sign in.");
      const { rows: created } = await c.query(
        `INSERT INTO staff (name, mobile, password_hash, role) VALUES ($1, $2, $3, 'admin')
         ON CONFLICT (mobile) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, active = TRUE
         RETURNING id`,
        [name, mobile, hash],
      );
      return created[0].id;
    });
    return json({ ok: true }, 200, { "Set-Cookie": await createSession(id) });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await readJson(req);
    let mobile = "";
    try {
      mobile = normaliseMobile(body.mobile);
    } catch {
      throw new HttpError(401, "Mobile number or password is incorrect.");
    }
    const password = String(body.password || "").slice(0, 128);
    const { rows } = await q(`SELECT id, password_hash, active, failed_logins, locked_until FROM staff WHERE mobile = $1`, [mobile]);
    const staff = rows[0];
    if (staff?.locked_until && new Date(staff.locked_until) > new Date())
      throw new HttpError(429, "Too many wrong attempts. Try again after 15 minutes.");
    const ok = staff ? await verifyPassword(password, staff.password_hash) : (await verifyPassword(password, await DUMMY_HASH), false);
    if (!ok || !staff.active) {
      if (staff)
        await q(
          `UPDATE staff SET
             locked_until = CASE WHEN failed_logins + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
             failed_logins = CASE WHEN failed_logins + 1 >= 5 THEN 0 ELSE failed_logins + 1 END
           WHERE id = $1`,
          [staff.id],
        );
      throw new HttpError(401, staff && ok && !staff.active ? "This staff account is disabled." : "Mobile number or password is incorrect.");
    }
    await q(`UPDATE staff SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [staff.id]);
    return json({ ok: true }, 200, { "Set-Cookie": await createSession(staff.id) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = cookieValue(req, SESSION_COOKIE);
    if (token) await q(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }

  if (path === "/api/auth/password" && method === "POST") {
    const staff = await requireStaff(req);
    const body = await readJson(req);
    const { rows } = await q(`SELECT password_hash FROM staff WHERE id = $1`, [staff.id]);
    if (!(await verifyPassword(String(body.current || "").slice(0, 128), rows[0].password_hash)))
      throw new HttpError(400, "Current password is incorrect.");
    await q(`UPDATE staff SET password_hash = $2 WHERE id = $1`, [staff.id, await hashPassword(checkPassword(body.next))]);
    const token = cookieValue(req, SESSION_COOKIE) || "";
    await q(`DELETE FROM sessions WHERE staff_id = $1 AND token_hash <> $2`, [staff.id, sha256(token)]);
    return json({ ok: true });
  }

  // --- staff management (admin) ---
  if (path === "/api/staff" && method === "GET") {
    await requireAdmin(req);
    const { rows } = await q(`SELECT id, name, mobile, role, active, created_at FROM staff ORDER BY id`);
    return json({ staff: rows });
  }
  if (path === "/api/staff" && method === "POST") {
    await requireAdmin(req);
    const body = await readJson(req);
    const role = body.role === "admin" ? "admin" : "staff";
    const { rows } = await q(
      `INSERT INTO staff (name, mobile, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (mobile) DO NOTHING RETURNING id`,
      [checkName(body.name), normaliseMobile(body.mobile), await hashPassword(checkPassword(body.password)), role],
    );
    if (!rows.length) throw new HttpError(409, "A staff account with this mobile number already exists.");
    return json({ ok: true, id: rows[0].id });
  }
  const staffMatch = /^\/api\/staff\/(\d+)$/.exec(path);
  if (staffMatch && method === "PATCH") {
    const admin = await requireAdmin(req);
    const id = Number(staffMatch[1]);
    const body = await readJson(req);
    if (id === admin.id && (body.active === false || body.role === "staff"))
      throw new HttpError(400, "You cannot disable or demote your own admin account.");
    if (body.password !== undefined) {
      await q(`UPDATE staff SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1`, [id, await hashPassword(checkPassword(body.password))]);
      await q(`DELETE FROM sessions WHERE staff_id = $1`, [id]);
    }
    if (typeof body.active === "boolean") {
      await q(`UPDATE staff SET active = $2 WHERE id = $1`, [id, body.active]);
      if (!body.active) await q(`DELETE FROM sessions WHERE staff_id = $1`, [id]);
    }
    if (body.role === "admin" || body.role === "staff") await q(`UPDATE staff SET role = $2 WHERE id = $1`, [id, body.role]);
    if (body.name !== undefined) await q(`UPDATE staff SET name = $2 WHERE id = $1`, [id, checkName(body.name)]);
    return json({ ok: true });
  }

  // --- bills ---
  if (path === "/api/bills" && method === "GET") {
    await requireStaff(req);
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const { rows } = await q(
      `SELECT body, version, sequence, change_seq FROM bills WHERE change_seq > $1 ORDER BY sequence`,
      [since],
    );
    const seq = rows.reduce((max, row) => Math.max(max, Number(row.change_seq)), since);
    return json({ bills: rows.map(billRow), seq });
  }
  if (path === "/api/bills" && method === "POST") {
    const staff = await requireStaff(req);
    const body = await readJson(req);
    return json({ bills: await saveBills(staff, body.changes) });
  }
  if (path === "/api/import" && method === "POST") {
    const staff = await requireStaff(req);
    return json(await importBills(staff, await readJson(req)));
  }

  // --- attachments ---
  if (path === "/api/attachments" && method === "GET") {
    await requireStaff(req);
    const billId = String(url.searchParams.get("bill") || "").toLowerCase();
    if (!UUID_RE.test(billId)) throw new HttpError(400, "Invalid bill.");
    const { rows } = await q(
      `SELECT id, bill_id AS "billId", name, kind, mime, size, created_at AS created FROM attachments WHERE bill_id = $1 ORDER BY created_at, id`,
      [billId],
    );
    return json({ attachments: rows });
  }
  if (path === "/api/attachments" && method === "POST") {
    return uploadAttachment(await requireStaff(req), req, url);
  }
  const fileMatch = /^\/api\/attachments\/([0-9a-f-]{36})$/i.exec(path);
  if (fileMatch && method === "GET") {
    await requireStaff(req);
    const { rows } = await q(`SELECT mime FROM attachments WHERE id = $1`, [fileMatch[1].toLowerCase()]);
    if (!rows.length) throw new HttpError(404, "Attachment not found.");
    const data = await files().get(fileMatch[1].toLowerCase(), { type: "arrayBuffer" });
    if (!data) throw new HttpError(404, "Attachment file is missing.");
    return new Response(data, {
      headers: {
        "Content-Type": rows[0].mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Content-Disposition": "attachment",
      },
    });
  }
  if (fileMatch && method === "DELETE") {
    await requireStaff(req);
    const id = fileMatch[1].toLowerCase();
    await q(`DELETE FROM attachments WHERE id = $1`, [id]);
    await files().delete(id);
    return json({ ok: true });
  }

  // --- shared shop settings ---
  if (path === "/api/settings/shop" && method === "GET") {
    await requireStaff(req);
    const { rows } = await q(`SELECT value FROM settings WHERE key = 'shop'`);
    return json({ shop: rows[0]?.value || null });
  }
  if (path === "/api/settings/shop" && method === "PUT") {
    await requireStaff(req);
    const body = await readJson(req);
    const shop: Record<string, string> = {};
    for (const key of ["shopname", "shopphone", "shopaddress", "shoppin", "shopgst"]) shop[key] = String(body?.shop?.[key] ?? "").slice(0, 400);
    await q(
      `INSERT INTO settings (key, value, updated_at) VALUES ('shop', $1::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(shop)],
    );
    return json({ ok: true, shop });
  }

  throw new HttpError(404, "Not found.");
}

export default async (req: Request) => {
  try {
    return await route(req);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("API error", error);
    return json({ error: "Server error. Please try again." }, 500);
  }
};

export const config: Config = {
  path: "/api/*",
};

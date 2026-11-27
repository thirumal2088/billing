-- Staff accounts: login with mobile number + password (scrypt hash, never plain text)
CREATE TABLE staff (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Login sessions: only a SHA-256 hash of the session token is stored
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_staff_idx ON sessions (staff_id);

-- Global change counter so every device can fetch only what changed
CREATE SEQUENCE change_seq;

-- Bills: full bill JSON (items, payments, stages, rack, customer, diary...) in body
CREATE TABLE bills (
  id UUID PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('order', 'direct')),
  body JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  sequence BIGSERIAL,
  change_seq BIGINT NOT NULL DEFAULT nextval('change_seq'),
  created_by INTEGER REFERENCES staff(id),
  updated_by INTEGER REFERENCES staff(id),
  imported BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX bills_change_idx ON bills (change_seq);
CREATE INDEX bills_mobile_idx ON bills ((body->>'mobile'));

-- Attachment metadata; file bytes live in Netlify Blobs under the attachment id
CREATE TABLE attachments (
  id UUID PRIMARY KEY,
  bill_id UUID NOT NULL REFERENCES bills(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'excel', 'audio')),
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by INTEGER REFERENCES staff(id)
);
CREATE INDEX attachments_bill_idx ON attachments (bill_id);

-- Shared shop settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

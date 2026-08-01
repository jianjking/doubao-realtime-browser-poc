CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status = 'active'),
  created_at TEXT NOT NULL CHECK (created_at <> ''),
  updated_at TEXT NOT NULL CHECK (updated_at <> '')
);

CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  balance_cents INTEGER NOT NULL
    CHECK (
      typeof(balance_cents) = 'integer'
      AND balance_cents BETWEEN -9007199254740991 AND 9007199254740991
    ),
  remaining_seconds INTEGER NOT NULL
    CHECK (
      typeof(remaining_seconds) = 'integer'
      AND remaining_seconds BETWEEN 0 AND 9007199254740991
    ),
  status TEXT NOT NULL CHECK (status = 'active'),
  created_at TEXT NOT NULL CHECK (created_at <> ''),
  updated_at TEXT NOT NULL CHECK (updated_at <> ''),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE calls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role_slug TEXT NOT NULL CHECK (role_slug <> ''),
  billing_unit_ms INTEGER NOT NULL
    CHECK (
      typeof(billing_unit_ms) = 'integer'
      AND billing_unit_ms BETWEEN 1 AND 9007199254740991
    ),
  price_per_billing_unit_fen INTEGER NOT NULL
    CHECK (
      typeof(price_per_billing_unit_fen) = 'integer'
      AND price_per_billing_unit_fen BETWEEN 1 AND 9007199254740991
    ),
  charge_fen INTEGER
    CHECK (
      charge_fen IS NULL
      OR (
        typeof(charge_fen) = 'integer'
        AND charge_fen BETWEEN 0 AND 9007199254740991
      )
    ),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'connecting', 'active', 'ended', 'failed')),
  created_at TEXT NOT NULL CHECK (created_at <> ''),
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER
    CHECK (
      duration_ms IS NULL
      OR (
        typeof(duration_ms) = 'integer'
        AND duration_ms BETWEEN 0 AND 9007199254740991
      )
    ),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (
    (status IN ('pending', 'connecting')
      AND started_at IS NULL
      AND ended_at IS NULL
      AND duration_ms IS NULL
      AND charge_fen IS NULL)
    OR (status = 'active'
      AND started_at IS NOT NULL
      AND started_at <> ''
      AND ended_at IS NULL
      AND duration_ms IS NULL
      AND charge_fen IS NULL)
    OR (status = 'ended'
      AND started_at IS NOT NULL
      AND started_at <> ''
      AND ended_at IS NOT NULL
      AND ended_at <> ''
      AND duration_ms IS NOT NULL
      AND charge_fen IS NOT NULL)
    OR (status = 'failed'
      AND (started_at IS NULL OR started_at <> '')
      AND ended_at IS NOT NULL
      AND ended_at <> ''
      AND duration_ms IS NOT NULL
      AND charge_fen = 0)
  )
);

CREATE INDEX calls_user_id_idx ON calls(user_id);

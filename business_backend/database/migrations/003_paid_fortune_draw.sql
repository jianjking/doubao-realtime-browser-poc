CREATE TABLE IF NOT EXISTS fortune_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL CHECK (client_request_id <> ''),
  fortune_session_id TEXT NOT NULL UNIQUE CHECK (fortune_session_id <> ''),
  character_key TEXT NOT NULL CHECK (character_key <> ''),
  catalog_version TEXT NOT NULL CHECK (catalog_version <> ''),
  fortune_snapshot_json TEXT NOT NULL CHECK (fortune_snapshot_json <> ''),
  price_cents INTEGER NOT NULL
    CHECK (
      typeof(price_cents) = 'integer'
      AND price_cents BETWEEN 1 AND 9007199254740991
    ),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  status TEXT NOT NULL CHECK (status = 'charged'),
  balance_before_cents INTEGER NOT NULL
    CHECK (
      typeof(balance_before_cents) = 'integer'
      AND balance_before_cents >= price_cents
    ),
  balance_after_cents INTEGER NOT NULL
    CHECK (
      typeof(balance_after_cents) = 'integer'
      AND balance_after_cents = balance_before_cents - price_cents
    ),
  created_at TEXT NOT NULL CHECK (created_at <> ''),
  charged_at TEXT NOT NULL CHECK (charged_at <> ''),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id) REFERENCES accounts(user_id) ON DELETE RESTRICT,
  UNIQUE (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS fortune_purchases_user_id_idx
  ON fortune_purchases(user_id);
CREATE INDEX IF NOT EXISTS fortune_purchases_account_id_idx
  ON fortune_purchases(account_id);
CREATE INDEX IF NOT EXISTS fortune_purchases_fortune_session_id_idx
  ON fortune_purchases(fortune_session_id);
CREATE INDEX IF NOT EXISTS fortune_purchases_created_at_idx
  ON fortune_purchases(created_at);

CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('wechat', 'alipay')),
  requested_scene TEXT NOT NULL
    CHECK (requested_scene IN (
      'wechat_jsapi',
      'wechat_h5',
      'alipay_wap',
      'mock'
    )),
  merchant_order_no TEXT NOT NULL UNIQUE CHECK (merchant_order_no <> ''),
  client_request_id TEXT NOT NULL CHECK (client_request_id <> ''),
  provider_trade_no TEXT UNIQUE,
  amount_cents INTEGER NOT NULL
    CHECK (
      typeof(amount_cents) = 'integer'
      AND amount_cents BETWEEN 1 AND 9007199254740991
    ),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'paid', 'credited', 'closed', 'failed')),
  created_at TEXT NOT NULL CHECK (created_at <> ''),
  expires_at TEXT NOT NULL CHECK (expires_at <> ''),
  paid_at TEXT,
  credited_at TEXT,
  closed_at TEXT,
  failure_code TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id) REFERENCES accounts(user_id) ON DELETE RESTRICT,
  UNIQUE (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS payment_orders_user_id_idx
  ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS payment_orders_account_id_idx
  ON payment_orders(account_id);
CREATE INDEX IF NOT EXISTS payment_orders_status_expires_at_idx
  ON payment_orders(status, expires_at);
CREATE INDEX IF NOT EXISTS payment_orders_created_at_idx
  ON payment_orders(created_at);

CREATE TABLE IF NOT EXISTS account_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  payment_order_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('recharge')),
  amount_cents INTEGER NOT NULL
    CHECK (
      typeof(amount_cents) = 'integer'
      AND amount_cents BETWEEN 1 AND 9007199254740991
    ),
  balance_before_cents INTEGER NOT NULL
    CHECK (
      typeof(balance_before_cents) = 'integer'
      AND balance_before_cents BETWEEN -9007199254740991 AND 9007199254740991
    ),
  balance_after_cents INTEGER NOT NULL
    CHECK (
      typeof(balance_after_cents) = 'integer'
      AND balance_after_cents BETWEEN -9007199254740991 AND 9007199254740991
    ),
  created_at TEXT NOT NULL CHECK (created_at <> ''),
  FOREIGN KEY (account_id) REFERENCES accounts(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (payment_order_id) REFERENCES payment_orders(id) ON DELETE RESTRICT,
  UNIQUE (payment_order_id, entry_type),
  CHECK (balance_after_cents = balance_before_cents + amount_cents)
);

CREATE INDEX IF NOT EXISTS account_ledger_account_created_at_idx
  ON account_ledger(account_id, created_at);
CREATE INDEX IF NOT EXISTS account_ledger_user_created_at_idx
  ON account_ledger(user_id, created_at);

CREATE TABLE IF NOT EXISTS payment_notifications (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('wechat', 'alipay')),
  provider_event_id TEXT NOT NULL CHECK (provider_event_id <> ''),
  payment_order_id TEXT,
  payload_digest TEXT NOT NULL
    CHECK (length(payload_digest) = 64 AND payload_digest NOT GLOB '*[^0-9a-f]*'),
  verification_status TEXT NOT NULL
    CHECK (verification_status IN ('verified', 'rejected')),
  processing_status TEXT NOT NULL
    CHECK (processing_status IN ('received', 'processed', 'failed')),
  received_at TEXT NOT NULL CHECK (received_at <> ''),
  processed_at TEXT,
  failure_code TEXT,
  FOREIGN KEY (payment_order_id) REFERENCES payment_orders(id) ON DELETE RESTRICT,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS payment_notifications_order_id_idx
  ON payment_notifications(payment_order_id);
CREATE INDEX IF NOT EXISTS payment_notifications_received_at_idx
  ON payment_notifications(received_at);
CREATE INDEX IF NOT EXISTS payment_notifications_processing_status_idx
  ON payment_notifications(processing_status);

CREATE TABLE sms_challenges (
  id TEXT PRIMARY KEY,
  phone_normalized TEXT NOT NULL
    CHECK (phone_normalized GLOB '+861[3-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  purpose TEXT NOT NULL CHECK (purpose = 'login'),
  status TEXT NOT NULL
    CHECK (
      status IN (
        'pending',
        'sent',
        'consumed',
        'invalidated',
        'expired',
        'send_failed',
        'locked'
      )
    ),
  provider TEXT NOT NULL
    CHECK (provider IN ('mock', 'aliyun')),
  provider_request_id TEXT,
  provider_biz_id TEXT,
  request_ip_digest TEXT NOT NULL
    CHECK (length(request_ip_digest) = 64),
  expires_at TEXT NOT NULL CHECK (expires_at <> ''),
  next_send_allowed_at TEXT NOT NULL
    CHECK (next_send_allowed_at <> ''),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 0),
  max_attempts INTEGER NOT NULL
    CHECK (typeof(max_attempts) = 'integer' AND max_attempts > 0),
  created_at TEXT NOT NULL CHECK (created_at <> ''),
  sent_at TEXT,
  consumed_at TEXT,
  invalidated_at TEXT,
  failure_code TEXT
);

CREATE INDEX sms_challenges_phone_created_idx
  ON sms_challenges(phone_normalized, created_at);
CREATE INDEX sms_challenges_ip_created_idx
  ON sms_challenges(request_ip_digest, created_at);
CREATE INDEX sms_challenges_phone_status_idx
  ON sms_challenges(phone_normalized, status);

CREATE TABLE IF NOT EXISTS __SCHEMA__.login_users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.login_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES __SCHEMA__.login_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_sessions_expiry ON __SCHEMA__.login_sessions(expires_at);

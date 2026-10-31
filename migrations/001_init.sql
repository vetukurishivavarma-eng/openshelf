CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	google_sub text UNIQUE,
	email text,
	name text NOT NULL,
	city text,
	pincode text,
	whatsapp text UNIQUE,
	credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0),
	banned_at timestamptz,
	deleted_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
	token_hash text PRIMARY KEY,
	user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
	expires_at timestamptz NOT NULL
);
CREATE INDEX ON sessions (user_id);

-- Rows are never deleted: the starter credit counts every listing ever made.
CREATE TABLE listings (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	owner_id uuid NOT NULL REFERENCES users,
	title text NOT NULL,
	author text NOT NULL,
	isbn text,
	tier text NOT NULL CHECK (tier IN ('paperback', 'premium')),
	condition text NOT NULL CHECK (condition IN ('like_new', 'good', 'worn')),
	status text NOT NULL DEFAULT 'available'
		CHECK (status IN ('available', 'reserved', 'gone', 'removed')),
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON listings (owner_id);
CREATE INDEX ON listings (status, created_at DESC);
CREATE INDEX listings_search ON listings USING gin ((title || ' ' || author) gin_trgm_ops);

CREATE TABLE swaps (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	listing_id uuid NOT NULL REFERENCES listings,
	owner_id uuid NOT NULL REFERENCES users,
	requester_id uuid NOT NULL REFERENCES users,
	credits integer NOT NULL CHECK (credits > 0),
	method text NOT NULL CHECK (method IN ('handover', 'post')),
	status text NOT NULL DEFAULT 'requested' CHECK (status IN (
		'requested', 'accepted', 'sent', 'disputed',
		'declined', 'cancelled', 'expired', 'received', 'refunded')),
	status_at timestamptz NOT NULL DEFAULT now(),
	address text,
	dispute_note text,
	warned_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	CHECK (owner_id <> requester_id),
	CHECK (address IS NULL OR status IN ('requested', 'accepted', 'sent', 'disputed'))
);
CREATE UNIQUE INDEX swaps_one_open ON swaps (listing_id)
	WHERE status IN ('requested', 'accepted', 'sent', 'disputed');
CREATE INDEX ON swaps (requester_id);
CREATE INDEX ON swaps (owner_id);
CREATE INDEX ON swaps (status, status_at);

CREATE TABLE credit_ledger (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	user_id uuid NOT NULL REFERENCES users,
	delta integer NOT NULL CHECK (delta <> 0),
	reason text NOT NULL CHECK (reason IN ('starter', 'hold', 'refund', 'earn')),
	swap_id uuid REFERENCES swaps,
	created_at timestamptz NOT NULL DEFAULT now(),
	CHECK ((reason = 'starter') = (swap_id IS NULL))
);
CREATE UNIQUE INDEX ledger_once ON credit_ledger (swap_id, reason, user_id);
CREATE UNIQUE INDEX ledger_one_starter ON credit_ledger (user_id) WHERE reason = 'starter';

CREATE FUNCTION credit_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'credit_ledger is append-only';
END $$;
CREATE TRIGGER credit_ledger_no_change BEFORE UPDATE OR DELETE ON credit_ledger
	FOR EACH ROW EXECUTE FUNCTION credit_ledger_append_only();
CREATE TRIGGER credit_ledger_no_truncate BEFORE TRUNCATE ON credit_ledger
	FOR EACH STATEMENT EXECUTE FUNCTION credit_ledger_append_only();

CREATE TABLE reports (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	reporter_id uuid NOT NULL REFERENCES users,
	listing_id uuid REFERENCES listings,
	user_id uuid REFERENCES users,
	reason text NOT NULL,
	resolved_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	CHECK (listing_id IS NOT NULL OR user_id IS NOT NULL)
);

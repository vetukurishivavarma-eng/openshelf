CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	google_sub text UNIQUE,
	-- Salted hash kept after deletion, so a ban still holds if the Google account returns.
	deleted_sub_hash text,
	email text,
	name text NOT NULL,
	city text,
	pincode text,
	whatsapp text UNIQUE,
	banned_at timestamptz,
	deleted_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON users (deleted_sub_hash) WHERE deleted_sub_hash IS NOT NULL;

CREATE TABLE sessions (
	token_hash text PRIMARY KEY,
	user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
	expires_at timestamptz NOT NULL
);
CREATE INDEX ON sessions (user_id);

CREATE TABLE listings (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	giver_id uuid NOT NULL REFERENCES users,
	title text NOT NULL,
	author text NOT NULL,
	isbn text,
	condition text NOT NULL CHECK (condition IN ('like_new', 'good', 'worn')),
	note text CHECK (char_length(note) <= 280),
	status text NOT NULL DEFAULT 'available'
		CHECK (status IN ('available', 'reserved', 'gone', 'removed')),
	-- One physical copy keeps one journey across every reader.
	journey_id uuid NOT NULL DEFAULT gen_random_uuid(),
	onward_from uuid UNIQUE,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON listings (giver_id);
CREATE INDEX ON listings (status, created_at DESC);
CREATE INDEX ON listings (journey_id);
CREATE INDEX listings_search ON listings USING gin ((title || ' ' || author) gin_trgm_ops);

CREATE TABLE orders (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	listing_id uuid NOT NULL REFERENCES listings,
	giver_id uuid NOT NULL REFERENCES users,
	reader_id uuid NOT NULL REFERENCES users,
	method text NOT NULL CHECK (method IN ('handover', 'post')),
	status text NOT NULL DEFAULT 'requested' CHECK (status IN (
		'requested', 'paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed',
		'declined', 'cancelled', 'expired', 'received', 'refunded')),
	status_at timestamptz NOT NULL DEFAULT now(),
	fee_paise integer NOT NULL CHECK (fee_paise >= 0),
	courier_paise integer NOT NULL CHECK (courier_paise >= 0),
	total_paise integer GENERATED ALWAYS AS (fee_paise + courier_paise) STORED,
	test_mode boolean NOT NULL,
	gateway_order_id text UNIQUE,
	payment_id text UNIQUE,
	address text,
	delivery_pincode text,
	pickup_address text,
	shipment_id text UNIQUE,
	dispute_note text,
	thank_you text CHECK (char_length(thank_you) <= 280),
	thanked_at timestamptz,
	warned_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	CHECK (giver_id <> reader_id),
	CONSTRAINT orders_address_wiped CHECK (
		(address IS NULL AND pickup_address IS NULL)
		OR status IN ('requested', 'paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed'))
);
CREATE UNIQUE INDEX orders_one_open ON orders (listing_id)
	WHERE status IN ('requested', 'paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed');
CREATE INDEX ON orders (reader_id, created_at);
CREATE INDEX ON orders (giver_id);
CREATE INDEX ON orders (status, status_at);

ALTER TABLE listings ADD FOREIGN KEY (onward_from) REFERENCES orders;

-- City snapshots, because a reader may move or delete their account. No user reference, on purpose.
CREATE TABLE journey_stops (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	journey_id uuid NOT NULL,
	city text NOT NULL,
	order_id uuid UNIQUE REFERENCES orders,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON journey_stops (journey_id, id);

CREATE TABLE webhook_events (
	event_id text PRIMARY KEY,
	kind text NOT NULL,
	received_at timestamptz NOT NULL DEFAULT now()
);

-- Outbox: the row is written with the state change, the provider is called after commit.
-- UNIQUE (payment_id) is what makes a refund exactly-once.
CREATE TABLE refunds (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	order_id uuid NOT NULL REFERENCES orders,
	payment_id text NOT NULL UNIQUE,
	amount_paise integer NOT NULL CHECK (amount_paise > 0),
	reason text NOT NULL,
	test_mode boolean NOT NULL,
	status text NOT NULL DEFAULT 'pending'
		CHECK (status IN ('pending', 'processing', 'sent', 'processed', 'failed')),
	attempts integer NOT NULL DEFAULT 0,
	attempted_at timestamptz,
	provider_refund_id text,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON refunds (status);
CREATE INDEX ON refunds (order_id);

CREATE TABLE reports (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	reporter_id uuid NOT NULL REFERENCES users,
	listing_id uuid REFERENCES listings,
	user_id uuid REFERENCES users,
	order_id uuid REFERENCES orders,
	subject text NOT NULL DEFAULT 'listing' CHECK (subject IN ('listing', 'user', 'note', 'thank_you')),
	reason text NOT NULL,
	resolved_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	CHECK (listing_id IS NOT NULL OR user_id IS NOT NULL)
);

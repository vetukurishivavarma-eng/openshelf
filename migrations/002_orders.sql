-- v2: a giver gives, a reader pays a fee plus courier. Credits are gone.
-- A v1 swap carries no payment, so any still open simply closes.
UPDATE swaps SET address = NULL, status = 'cancelled', status_at = now()
	WHERE status IN ('requested', 'accepted', 'sent', 'disputed');
UPDATE listings SET status = 'available' WHERE status = 'reserved';

DROP TABLE credit_ledger;
DROP FUNCTION credit_ledger_append_only();

ALTER TABLE users
	DROP COLUMN credits,
	ADD COLUMN deleted_sub_hash text;
CREATE INDEX ON users (deleted_sub_hash) WHERE deleted_sub_hash IS NOT NULL;

ALTER TABLE swaps RENAME TO orders;
ALTER INDEX swaps_one_open RENAME TO orders_one_open_old;
DROP INDEX orders_one_open_old;
ALTER TABLE orders
	DROP COLUMN credits,
	DROP CONSTRAINT swaps_status_check,
	DROP CONSTRAINT swaps_check1,
	ADD COLUMN fee_paise integer NOT NULL DEFAULT 0 CHECK (fee_paise >= 0),
	ADD COLUMN courier_paise integer NOT NULL DEFAULT 0 CHECK (courier_paise >= 0),
	ADD COLUMN total_paise integer GENERATED ALWAYS AS (fee_paise + courier_paise) STORED,
	ADD COLUMN test_mode boolean NOT NULL DEFAULT false,
	ADD COLUMN gateway_order_id text UNIQUE,
	ADD COLUMN payment_id text UNIQUE,
	ADD COLUMN delivery_pincode text,
	ADD COLUMN pickup_address text,
	ADD COLUMN shipment_id text UNIQUE,
	ADD COLUMN thank_you text CHECK (char_length(thank_you) <= 280),
	ADD COLUMN thanked_at timestamptz,
	ADD CONSTRAINT orders_status_check CHECK (status IN (
		'requested', 'paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed',
		'declined', 'cancelled', 'expired', 'received', 'refunded')),
	ADD CONSTRAINT orders_address_wiped CHECK (
		(address IS NULL AND pickup_address IS NULL)
		OR status IN ('requested', 'paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed'));
CREATE UNIQUE INDEX orders_one_open ON orders (listing_id)
	WHERE status IN ('requested', 'paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed');

ALTER TABLE listings
	DROP COLUMN tier,
	ADD COLUMN note text CHECK (char_length(note) <= 280),
	ADD COLUMN journey_id uuid NOT NULL DEFAULT gen_random_uuid(),
	ADD COLUMN onward_from uuid UNIQUE REFERENCES orders;
CREATE INDEX ON listings (journey_id);

-- City snapshots, because a reader may move or delete their account. No user reference, on purpose.
CREATE TABLE journey_stops (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	journey_id uuid NOT NULL,
	city text NOT NULL,
	order_id uuid UNIQUE REFERENCES orders,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON journey_stops (journey_id, id);
INSERT INTO journey_stops (journey_id, city)
	SELECT l.journey_id, u.city FROM listings l JOIN users u ON u.id = l.owner_id
	WHERE u.city IS NOT NULL AND l.status <> 'removed';

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

ALTER TABLE reports
	DROP CONSTRAINT reports_check,
	ADD COLUMN order_id uuid REFERENCES orders,
	ADD COLUMN subject text NOT NULL DEFAULT 'listing'
		CHECK (subject IN ('listing', 'user', 'note', 'thank_you')),
	ADD CONSTRAINT reports_target CHECK (listing_id IS NOT NULL OR user_id IS NOT NULL);

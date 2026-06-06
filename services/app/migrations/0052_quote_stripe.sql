-- 0052_quote_stripe (actual revenue): a real Stripe Checkout Session opened for a
-- quote, for the EXACT quoted amount. On a verified checkout.session.completed webhook
-- the quote moves to 'paid', revenue is booked, and delivery is auto-fulfilled. Nothing
-- moves real money until the operator provisions STRIPE_API_KEY + STRIPE_WEBHOOK_SECRET.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS stripe_session_id text;

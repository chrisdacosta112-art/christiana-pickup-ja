# Christiana Pick Up JA — Booking Platform v2

Includes:
- Public mobile booking page
- Driver login
- Mobile-friendly driver dashboard
- Booking statuses: NEW, ACCEPTED, EN_ROUTE, ARRIVED, COMPLETED, CANCELLED
- Fare/price field on each booking
- Automatic dashboard refresh and new-booking vibration/title alert
- Optional Twilio SMS + WhatsApp notifications
- SQLite for local/testing use

## Local run
1. Install Node.js 20+.
2. Extract this folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env` and change the driver password and JWT secret.
5. Run `npm start`.
6. Customer page: `http://localhost:3000/`
7. Driver login: `http://localhost:3000/login.html`

## Production notes
For a real public service, use a persistent database (for example Supabase/Postgres) rather than local SQLite on ephemeral hosting. Keep Twilio credentials and JWT_SECRET in the host's secret/environment settings, never in browser code or Git.

The default driver is created on first startup from DEFAULT_DRIVER_* environment variables.

# W-Form

W-Form is a multi-channel registration platform: build reusable forms, collect responses from the web and WhatsApp, manage submissions in an admin dashboard, and export records.

## Project status

Foundation scaffold is being built. WhatsApp phone-number and business-account properties will be configured later; no phone number is assumed.

## Planned stack

- Cloudflare Workers API and webhook
- Cloudflare D1 database
- Static admin and public form application
- Meta WhatsApp Cloud API

## Security

Never commit Meta access tokens, app secrets, webhook secrets, or production credentials. Configure these as encrypted Worker secrets. Admin routes must be protected before production use.

See `docs/SETUP.md` for the implementation and deployment checklist.

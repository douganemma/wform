# W-Form — setup and deployment

## What has been built

- Responsive admin workspace with overview, registrations, forms, visual builder, WhatsApp setup and settings pages.
- Reusable form records and configurable question types: text, long text, email, phone, number, date, single choice, multiple choice, dropdown and checkbox.
- Starter registration form with name, title (Mr/Mrs/Ms/Dr/Other), phone, email and interests.
- Public registration endpoint and shared D1 data model for website and WhatsApp responses.
- Submissions search, channel/source and status fields, timestamps and CSV export endpoint.
- Cloudflare Worker API, D1 schema and WhatsApp Cloud API webhook foundation.
- Webhook verification handshake and HMAC signature validation using Meta app secret.
- Conversational question flow, single-choice validation, multiple-choice parsing, incomplete conversation resumption, STOP opt-out, START restart and confirmation response.
- Admin API protected by Cloudflare Access JWT validation.

## Local setup

1. Install Node.js 20 or later.
2. Clone the repository and run npm install.
3. Create a Cloudflare D1 database named wform-db. Update database_id in wrangler.jsonc with the real ID.
4. Apply db/schema.sql to your local D1 database: npx wrangler d1 execute wform-db --local --file=db/schema.sql
5. Build the front end: npm run build.
6. Run the Worker locally with npx wrangler dev. The Worker serves the built files from dist and exposes the API on the same origin.

## Deploy to Cloudflare

1. Create the D1 database and update wrangler.jsonc with its database ID.
2. Apply the schema to the remote database: npx wrangler d1 execute wform-db --remote --file=db/schema.sql
3. Create a Cloudflare Access self-hosted application for the W-Form hostname. Require authentication and allow only the intended administrators.
4. Configure Worker variables ACCESS_TEAM_DOMAIN and ACCESS_AUD. ACCESS_TEAM_DOMAIN is your Cloudflare Access team domain without https://; ACCESS_AUD is the Access application's audience tag.
5. Add the following as encrypted Worker secrets, never as source files or GitHub variables:
   - WA_ACCESS_TOKEN
   - WA_PHONE_NUMBER_ID
   - WA_VERIFY_TOKEN
   - META_APP_SECRET
6. Build and deploy: npm run build, then npx wrangler deploy.
7. In Meta's developer dashboard, configure the webhook URL as https://YOUR-HOSTNAME/webhooks/whatsapp, enter the same verify token, subscribe to messages and use the same Meta app secret.
8. Send a test registration from a phone number that has opted in.

## WhatsApp setup to complete in the later session

The WhatsApp number and business-account properties are deliberately not collected now, as requested. We will later need the Meta app, WhatsApp Business Account ID, phone-number ID, display number, display-name/verification status, permanent access token, app secret, webhook verify token and chosen registration form. Credentials must be entered as encrypted Cloudflare Worker secrets, not pasted into chat or committed to GitHub.

## Important current limitations

This is the first build foundation, not yet a production-certified release. Before collecting real personal data, complete and test the deployment checklist and review local privacy and data-protection obligations.

- The current WhatsApp flow starts the first published form. Per-form selection and admin assignment of a WhatsApp flow are not yet exposed in the UI.
- Multi-select is collected by asking the user to reply with comma-separated option numbers. WhatsApp does not offer a native multi-select list control.
- The webhook currently handles incoming message events and basic text/button/list reply text. Delivery-status reporting, message deduplication, approved template-message management, media/document intake, retry queueing and advanced opt-in management still need implementation and testing.
- The bot does not yet send a dedicated consent question before asking form questions. Configure a consent/opt-in step and approved privacy notice before live use.
- The public preview currently renders the starter form. Dynamic public form rendering from the form builder, conditional questions, file upload and per-form public routes remain to be completed.
- CSV export is available. XLSX export, detailed submission view/edit, bulk deletion, role levels, audit-log viewer and configurable retention/deletion tools remain to be completed.
- Configure Cloudflare Access before exposing the admin interface. Admin API requests are rejected unless a valid Access JWT is supplied.
- The frontend uses preview/fallback behaviour when the API cannot be reached. This is not a substitute for successful deployment and live end-to-end testing.
- Do not add production phone numbers, access tokens, app secrets or real personal data to demo/test fixtures.

## Data model

D1 tables: forms, form_fields, submissions, responses, conversations, wa_messages and audit_log. Website and WhatsApp submissions use the same forms and responses tables. Conversation state is tracked separately so an interrupted WhatsApp registration can resume.

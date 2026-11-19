# W-Form — setup and deployment

## Current deployment
- Cloudflare Worker API: `w-form-api`
- Worker URL: `https://w-form-api.edougan.workers.dev`
- D1 database: `wform-db` (already created and schema applied)
- Website assets are deployed by the GitHub Actions workflow after its Cloudflare credentials are added.
- The Worker currently has the API code and D1 binding. The React website is not yet published until the deployment workflow completes successfully.

## First-time deployment through GitHub Actions

1. Open the repository: https://github.com/douganemma/wform
2. Go to **Settings → Secrets and variables → Actions**.
3. Under **Repository secrets**, add:
   - `CLOUDFLARE_API_TOKEN` — create a Cloudflare API token with permission to edit Workers scripts and deploy Workers, and access the W-Form D1 database as required by Wrangler.
4. Under **Repository variables**, add:
   - `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID.
5. Open **Actions → Deploy W-Form to Cloudflare → Run workflow**. Wait for the job to finish successfully. Later pushes to the main branch will deploy automatically.
6. Do not add Meta or WhatsApp credentials to GitHub. Add those directly as encrypted Worker secrets in Cloudflare.

## Add WhatsApp secrets in Cloudflare

Open **Cloudflare Dashboard → Workers & Pages → w-form-api → Settings → Variables and Secrets → Add**. Choose **Secret** (not Plaintext) for each of these:

- `WA_ACCESS_TOKEN` — the permanent WhatsApp Cloud API system-user access token.
- `WA_VERIFY_TOKEN` — a random phrase you create. Use the exact same value in Meta's webhook verification field.
- `META_APP_SECRET` — the App Secret from Meta. Because the previous value was shared in a chat, regenerate/rotate it in Meta first, then paste the new value here.

Save each secret and redeploy the Worker if Cloudflare prompts you.

**Do not add these as secrets:** `WA_PHONE_NUMBER_ID`, `WA_BUSINESS_ACCOUNT_ID`, and `META_APP_ID` are identifiers already configured as non-secret Worker variables in `wrangler.jsonc`.

## Configure Cloudflare Access for the admin API

1. In Cloudflare Zero Trust, create an Access application for the W-Form hostname.
2. Protect only the admin API path `/api/admin/*`. Keep `/webhooks/whatsapp` and public registration routes outside the Access login requirement so Meta and registrants can reach them.
3. Add an allow policy for your administrator email address.
4. In **Workers & Pages → w-form-api → Settings → Variables and Secrets**, add these as **Plaintext variables**:
   - `ACCESS_TEAM_DOMAIN` — your Zero Trust team domain, without `https://` (example format: `your-team.cloudflareaccess.com`).
   - `ACCESS_AUD` — the Access application's AUD tag.
5. Redeploy after adding the variables.

## Configure Meta webhook

In Meta for Developers → your W-Form app → WhatsApp → Configuration:

- Callback URL: `https://w-form-api.edougan.workers.dev/webhooks/whatsapp`
- Verify token: the exact value you stored as `WA_VERIFY_TOKEN`.
- Subscribe to the `messages` webhook field.
- Make sure the app secret in Meta is the same newly rotated value stored as `META_APP_SECRET`.

Then send a test message to the connected WhatsApp Business phone number. The bot starts the first published form and asks for consent before collecting answers.

## Security reminders

- Never commit access tokens, app secrets, verify tokens or Cloudflare API tokens to GitHub.
- Do not paste secrets into chat. Enter them directly in Cloudflare's Secret fields.
- Restrict admin access with Cloudflare Access before using real registration data.
- Test the complete web and WhatsApp journeys before production use and review applicable privacy/data-protection requirements.

## Current product limitations

This is a working foundation, not yet a production-certified release. The following still need implementation or end-to-end testing:
- Dynamic public form rendering from the builder and per-form public routes (the current public preview is the starter form).
- WhatsApp form assignment/selection, approved template management, media/document intake, retry queueing and advanced opt-in management.
- Submission detail/edit screen, bulk deletion, role levels, audit-log viewer and retention/deletion tools.
- Full live tests of webhook events, Cloudflare Access, exports and real WhatsApp messaging.

## Data model

D1 tables: forms, form_fields, submissions, responses, conversations, wa_messages, wa_delivery_events and audit_log. Website and WhatsApp registrations share the forms and responses tables.

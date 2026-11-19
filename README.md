# W-Form

W-Form is a multi-channel registration platform for reusable forms, web submissions and WhatsApp chatbot registrations.

## Included foundation
- Responsive admin dashboard and visual form builder.
- Starter registration form and reusable form/field schema.
- Website registration API and shared Cloudflare D1 storage.
- Cloudflare Worker API with admin endpoints protected by Cloudflare Access JWT validation.
- WhatsApp Cloud API webhook foundation: verification, signature validation, conversational question flow, choice and multi-choice parsing, incomplete registration resume, STOP opt-out and START restart.
- CSV export and GitHub Actions build check.

## Stack
React + Vite frontend, Cloudflare Workers API, Cloudflare D1 database and Meta WhatsApp Cloud API.

## Getting started
Read [docs/SETUP.md](docs/SETUP.md) for local setup, Cloudflare deployment and the WhatsApp onboarding checklist.

## WhatsApp configuration
Phone-number properties and account identifiers are intentionally deferred until the later setup conversation. Never commit WhatsApp tokens or secrets to GitHub.

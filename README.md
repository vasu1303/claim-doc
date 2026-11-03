# Patient Locker and Automatic Query Response

A local assignment application with private patient lockers, role-scoped access,
automatic insurer-query analysis, and independent WhatsApp/email delivery history.
Only fictional/synthetic data is authorized in this build.

## Requirements and quick start (Windows, no Docker)

- Node.js 20.19+ (Node 24 recommended), npm, and Python 3.12 with the `py` launcher.
- No PostgreSQL or MinIO installation is needed for the default configuration.
- Run all commands from the repository root.

```powershell
npm install
npm run setup
npm run dev
```

Open <http://localhost:3000>. Use `ADMIN_EMAIL` and the generated `ADMIN_PASSWORD`
from the **root `.env`**. Setup generates strong secrets without printing them.
It installs a dedicated Python environment and creates ten **fictional** patient
lockers, each with a discharge summary and policy copy. Re-running setup/seed does
not reset existing passwords.

The original repository contained sample profiles but no supplied document pack,
query-letter pack, or official message template. The files under `samples/` are
clearly labelled synthetic replacements, not the assignment's official test set.
Replace `config/message-template.txt` with the supplied template when available.

The application starts four local services:

| Service | Address |
|---|---|
| Next.js portal | http://localhost:3000 |
| Express API and durable worker | http://127.0.0.1:8000 |
| FastAPI analysis/OCR | http://127.0.0.1:8001 |
| Notification service | http://127.0.0.1:8002 |

Use Ctrl+C to stop the services. Run only one backend process against an embedded
database directory. Data persists in `data/postgres` and private files in
`data/files`; restarting the app does not reset them. Back up these directories
together while the application is stopped. Never publish them.

## Demonstrate the complete automatic flow

1. Sign in as administrator and open a freshly seeded `DEMO-...` patient locker
   (one where you have not already uploaded a hospital bill).
2. Select **Queries**, and upload `samples/queries/mixed-query.txt`.
3. Processing starts without any additional action. Open the query to watch it.
4. Expected result:
   - discharge summary: **available**
   - hospital bill: **missing**
   - policy copy: **available**
   - reason for delayed notification: **clarification needed**
5. Both channels appear in message history. Default **mock** mode records
   `mock_sent` and is prominently labelled **not delivered**. It makes no
   external calls.
6. Upload `samples/documents/hospital-bill.txt` under **Hospital Bill**.
   The system indexes it, reassesses existing queries, and automatically creates
   an updated notification that no longer asks for the bill.
7. `samples/queries/all-available.txt` must result in no request for new documents.

The portal refreshes processing and delivery status automatically. If indexing or
analysis fails, the error is visible; it never invents a successful analysis or
sends a fabricated request. Staff can retry failed indexing/queries after fixing
the cause. A written explanation may be uploaded as an `Other` text/PDF document;
OpenAI mode can match it only with explicit quoted evidence.

## Enable unseen letters and scanned PDFs

Edit the root `.env`, then restart:

```dotenv
ANALYSIS_MODE=openai
OPENAI_API_KEY=<your local key>
OPENAI_MODEL=gpt-4o-mini
```

- Demo mode deliberately processes **only labelled numbered demo letters**; it
  is not an alternative to AI for unseen evaluation letters.
- OpenAI mode reads arbitrary synthetic letters using structured JSON output.
  Text PDFs are extracted locally. Images and scanned PDF pages use vision OCR.
- All requests and subpoints are decomposed; dates, signatures, test names and
  other qualifiers are preserved.
- Generic document requests match exact locker categories. Qualified requests
  and clarifications require a model-selected locker document and a verbatim
  evidence quote validated against its extracted text.
- Low-confidence, unreadable, incomplete, oversized, or invalid results stop with
  a review/error status rather than automatically asking the patient for a guess.
- Limits: 20 MB per file, 30 PDF pages, 100,000 extracted characters per file,
  150,000 combined analysis characters, 200 locker documents, 100 query points.
  Limits fail visibly rather than silently dropping pages or requirements.

All external processing and delivery reject lockers marked non-synthetic.
Do not upload real patient records or use genuine contact information in fixtures.
Actual provider keys belong only in the ignored root `.env`, never in source or
chat. The old service-specific environment files are not used by the new services.
If any previously committed credentials were genuine, rotate them: ignoring a file
does not remove it from Git history.

## Enable actual WhatsApp and email delivery

Set these locally and restart:

```dotenv
DELIVERY_MODE=live
WHATSAPP_TOKEN=<Meta access token>
WHATSAPP_PHONE_NUMBER_ID=<Meta test sender phone-number ID>
WHATSAPP_TEST_NUMBER=<approved test recipient with country code>
RESEND_API_KEY=<Resend API key>
EMAIL_FROM=<verified sender>
EMAIL_TEST_TO=<authorized test inbox>
```

Both explicit test recipients are required for their respective channels.
The application never silently sends to the fictional profile's contacts.

### WhatsApp setup

1. Create a Meta developer app with WhatsApp and use its test sender.
2. Add and verify your test recipient in the Meta developer dashboard.
3. Obtain the token and sender phone-number ID from the WhatsApp API setup page.
4. For free-form messages, the recipient must first message your WhatsApp business
   number to open the 24-hour service conversation window.
5. Outside that window, configure an approved template using
   `WHATSAPP_TEMPLATE_NAME` and `WHATSAPP_TEMPLATE_LANGUAGE`. This implementation
   expects a body template with a **single text parameter `{{1}}`** containing
   the complete generated notification. Use a provider-approved compatible
   template; the sample `hello_world` template is not compatible.
6. Set `WHATSAPP_API_VERSION` to a version supported by your Meta application.

Meta may reject long messages/template parameters. Such failures are recorded,
not marked sent. Template parameters are whitespace-normalized and limited to
1024 characters; free-form text is limited to 4096. Use a concise official
message template.

### Email setup

Verify a sending domain with Resend, configure `EMAIL_FROM`, and use an allowed
test inbox. Resend sandbox accounts may restrict recipient addresses.

The email idempotency key is stable per message/channel. Each channel records its
own provider identifier and error independently. Confirmed rate-limit rejections
retry with backoff. Ambiguous network timeouts/crashes are recorded as `unknown`
instead of blindly duplicating WhatsApp messages. Check provider dashboards
before resending an unknown outcome.

**`sent` means the provider accepted the request, not that the recipient read it
or that a delivery receipt was received.** Delivery webhooks are not implemented.
Real phone/inbox receipt cannot be validated without configured providers; mock
and intercepted-provider tests are not proof of actual delivery.

## Roles and patient-data access

- **Admin:** all lockers; provision accounts; assign staff; enable/disable users.
- **Staff:** only assigned lockers and lockers they create; upload query letters;
  update profiles and manage documents.
- **Patient:** only their linked locker; read query/results/history; upload
  supporting documents; download their own files. Cannot create patients, upload
  insurer queries, provision users, or access other patients.

Create patient accounts under **Accounts & access**, linking the account to a
locker. Assign staff under the locker's Overview tab. Public self-registration is
disabled. All resource access is checked on the server, including nested
file/query paths, lists, and dashboard aggregates. Disabled accounts and logout
invalidate existing server-side sessions.

JWTs expire after eight hours and are stored only in browser session storage.
Passwords use bcrypt; login is rate-limited; file type/size/signatures are checked;
storage URLs are not public; services use an internal shared token and bind to
loopback. Audit records track authentication and important locker operations
without recording file content or notification bodies in access logs.

Local disk is not application-encrypted: use OS account permissions, encrypted
disks, and encrypted backups. This local assignment build is **not a certified
production medical-record system**. Internet deployment needs HTTPS, a secrets
manager, consent/retention policies, monitoring, delivery receipts, and a reviewed
multi-instance worker/locking deployment.

## Persistence, retries, and templates

- Database jobs are saved alongside uploads. Startup recovers interrupted jobs
  and repairs missing queued work. Analysis retries transient failures with
  backoff; permanent validation failures require correction.
- Analysis results and generated notifications are committed together.
- New documents trigger reassessment; unchanged notification text is not sent
  again. Historical message revisions remain visible.
- Each message/channel is marked `sending` before calling its provider.
  Crash recovery marks interrupted sends `unknown` to avoid accidental duplicates.
- A completed query means **analysis completed**, not that both messages arrived.
- Claim status tracks document readiness; staff explicitly mark a claim completed.
- Customize the fixed template at `config/message-template.txt`, or set
  `MESSAGE_TEMPLATE_PATH`. Supported placeholders are `{patient_name}`,
  `{patient_id}`, `{required_items}`, `{portal_url}`. Name/items are required.

## Optional external PostgreSQL and S3

Set `DATABASE_URL` to use an installed PostgreSQL instance; schema updates run at
startup. The schema extends the original tables without dropping existing data.
Legacy raw-URL files must be uploaded again to use the private-storage pipeline.
Original rows are not automatically labelled synthetic.

For private S3-compatible storage, set `FILE_STORAGE=s3` and the MinIO settings in
`.env.example`. The backend performs authenticated S3 reads; analysis receives
file bytes through the authenticated internal API, never arbitrary remote URLs.

## Validation commands

```powershell
npm test
npm run test:ai
npm run build
npm run lint --workspace frontend
```

The backend integration suite uses a temporary persistent database/files
directory, the **actual Python service**, the notification service in explicit mock
mode, real HTTP uploads and the automatic worker. It covers decomposition,
existing-document exclusion, new-document reassessment, all-available letters,
authorization, private downloads, invalid uploads, and visible analysis failure.
Temporary test files are deleted. Provider adapter tests intercept network calls;
no credentials or real recipients are needed.

The verified production dependency audit (`npm audit --omit=dev`) has no
advisories. A full audit may still report development-only ESLint/glob/minimatch
advisories; do not apply npm's suggested major-version downgrades or incompatible
overrides blindly. These tooling dependencies are not used by the running API,
analysis, notification, or production portal routes.

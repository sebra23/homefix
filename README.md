# Homefix MVP

WhatsApp-first AI procurement platform for Swedish home services.

## What this does

1. Customer sends a WhatsApp message (text, photo, video, voice)
2. AI extracts structured job details (category, address, size, etc.)
3. AI asks for missing information using category-specific rules
4. When complete, job appears in admin dashboard
5. You manually send RFQ to 3 contractors via WhatsApp
6. Contractors reply however they want
7. AI structures their quotes
8. You review and approve quotes in dashboard
9. System sends comparison to customer via WhatsApp
10. Customer selects a contractor
11. Both parties are notified, commission is recorded

## Quick Start

### 1. Clone & Install

```bash
git clone <repo>
cd homefix-mvp
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
# Required
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
TWILIO_SID=AC...
TWILIO_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# R2 (media storage)
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_BUCKET=homefix-media
R2_PUBLIC_URL=https://pub-<hash>.r2.dev
```

### 3. Database Setup

```bash
# Create database (Supabase, Railway, or local)
# Then run:
npm run db:setup
```

### 4. Seed Contractors

```bash
curl -X POST http://localhost:3000/api/seed-contractors
```

### 5. Start Server

```bash
npm run dev
```

### 6. Configure Twilio Webhook

In your Twilio console, set the WhatsApp webhook URL to:
```
https://your-domain.com/webhook/whatsapp
```

For local development, use ngrok:
```bash
ngrok http 3000
```

### 7. Open Dashboard

Go to `http://localhost:3000`

## Architecture

```
Customer WhatsApp → Twilio Webhook → Express Server
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
              AI Extraction          PostgreSQL              R2 Storage
              (OpenAI GPT-4o)        (Jobs, Messages,        (Images, Videos)
                                     Quotes, Contractors)
                                          │
                    ┌─────────────────────┘
                    ▼
              Admin Dashboard
              (Single-page HTML)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/webhook/whatsapp` | Twilio WhatsApp webhook |
| GET | `/api/jobs` | List all jobs with quotes |
| GET | `/api/jobs/:id` | Get job with messages, quotes, transitions |
| POST | `/api/jobs/:id/send-to-contractors` | Send RFQ to matching contractors |
| POST | `/api/jobs/:id/contractor-reply` | Simulate contractor reply (testing) |
| POST | `/api/quotes/:id/approve` | Approve a quote |
| POST | `/api/quotes/:id/clarify` | Request clarification from contractor |
| POST | `/api/jobs/:id/send-comparison` | Send quote comparison to customer |
| POST | `/api/jobs/:id/award` | Customer selects a quote |
| POST | `/api/seed-contractors` | Seed demo contractors |

## State Machine

```
NEW → COLLECTING_INFORMATION → READY_FOR_RFQ → COLLECTING_QUOTES
                                                    ↓
CUSTOMER_REVIEW ← READY_FOR_CUSTOMER ← (comparison sent)
    ↓
AWARDED → WORK_SCHEDULED → COMPLETED → COMMISSION_DUE → CLOSED
```

## Testing the Flow

1. Send a WhatsApp message to your Twilio sandbox number:
   ```
   Hej! Jag behöver hjälp med att lägga om taket på min villa i Täby.
   Det är ca 150 kvm och tegel. Kan ni hjälpa mig?
   ```

2. The AI will ask for missing info (address, desired date, etc.)

3. Reply with the missing info

4. When complete, the job appears in dashboard as "Redo för offert"

5. Click "Skicka till hantverkare" in dashboard

6. Simulate a contractor reply:
   ```bash
   curl -X POST http://localhost:3000/api/jobs/<job-id>/contractor-reply \
     -H "Content-Type: application/json" \
     -d '{"contractor_id":"<contractor-uuid>","reply_text":"Vi kan göra det för 185000 kr inkl moms. Start v 38. Tar ca 2 veckor. Material ingår."}'
   ```

7. Approve the quote in dashboard

8. Click "Skicka jämförelse till kund"

9. Customer receives comparison via WhatsApp and replies with "A"

10. System awards job and notifies both parties

## Commission Model

5% of order value, capped at 5,000 SEK. No cliff.

| Order Value | Commission |
|-------------|------------|
| 15,000 SEK | 750 SEK |
| 50,000 SEK | 2,500 SEK |
| 100,000 SEK | 5,000 SEK |
| 200,000 SEK | 5,000 SEK |

## Swedish Tax Integration

The system tracks ROT/RUT eligibility per job:
- `rot_eligible`: boolean (repair/renovation on private residence)
- `rut_eligible`: boolean (cleaning, gardening, IT support)

Contractors must have `rot_approved` and `f_tax_verified` flags.

## Important Notes

- **Media URLs expire in ~5 minutes.** The webhook downloads to R2 immediately before any AI processing.
- **Human review is required** for contractor quotes before sending to customers.
- **WhatsApp 24-hour session window:** After 24h of inactivity, only pre-approved templates can be sent.
- **GDPR:** Photos/videos of homes are personal data. Implement retention policy (suggested: 90 days post-completion).

## Next Steps (Post-MVP)

- [ ] Voice note transcription (Whisper API)
- [ ] Automated contractor matching by geolocation
- [ ] Commission payment processing (Stripe)
- [ ] Contractor self-service portal
- [ ] Customer review/rating system
- [ ] Skatteverket ROT/RUT API integration
- [ ] Insurance verification automation
- [ ] Multi-language support (English, Finnish)

## License

MIT

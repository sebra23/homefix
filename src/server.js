import express from 'express';
import { handleWebhook } from './whatsapp/webhook.js';
import { db } from './db/jobs.js';
import { parseQuote } from './ai/parseQuote.js';
import { calculateCommission } from './lib/commission.js';
import { pool } from './config/database.js';
import pkg from 'twilio';
const { Twilio } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const twilio = new Twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Twilio WhatsApp webhook
app.post('/webhook/whatsapp', handleWebhook);

// ============================================
// API ENDPOINTS
// ============================================

// Get all jobs with quotes (for dashboard)
app.get('/api/jobs', async (req, res) => {
    try {
        const jobs = await db.getJobsWithQuotes();
        res.json(jobs);
    } catch (err) {
        console.error('GET /api/jobs error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get single job with messages
app.get('/api/jobs/:id', async (req, res) => {
    try {
        const job = await db.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const { rows: messages } = await pool.query(
            'SELECT * FROM messages WHERE job_id = $1 ORDER BY created_at ASC',
            [req.params.id]
        );

        const { rows: quotes } = await pool.query(
            `SELECT q.*, c.name as contractor_name, c.company_name, c.whatsapp as contractor_whatsapp
             FROM quotes q
             JOIN contractors c ON q.contractor_id = c.id
             WHERE q.job_id = $1
             ORDER BY q.created_at ASC`,
            [req.params.id]
        );

        const { rows: transitions } = await pool.query(
            'SELECT * FROM state_transitions WHERE job_id = $1 ORDER BY created_at ASC',
            [req.params.id]
        );

        res.json({ ...job, messages, quotes, transitions });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send job to contractors (manual action from dashboard)
app.post('/api/jobs/:id/send-to-contractors', async (req, res) => {
    try {
        const job = await db.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const contractors = await db.findContractorsForJob(job.category, job.postcode);

        if (contractors.length === 0) {
            return res.status(400).json({ error: 'No matching contractors found' });
        }

        const selected = contractors.slice(0, 3);

        for (const c of selected) {
            const rfqText = `🔨 Nytt jobb: ${job.description || 'Hantverksjobb'}

📍 Plats: ${job.address || 'Ej angivet'}${job.postcode ? ', ' + job.postcode : ''}
📐 Storlek: ${job.estimated_size || 'Ej angivet'}
📅 Önskat datum: ${job.requested_date || 'Ej angivet'}

Svara med:
💰 Pris (inkl/exkl moms):
📅 Tidigaste start:
⏱️ Ungefärlig tidsåtgång:
📝 Övrigt:`;

            if (c.whatsapp) {
                await twilio.messages.create({
                    from: process.env.TWILIO_WHATSAPP_NUMBER,
                    to: c.whatsapp,
                    body: rfqText
                });
            }

            await db.createMessage({
                job_id: job.id,
                direction: 'outbound',
                channel: 'whatsapp',
                to_number: c.whatsapp,
                body: rfqText
            });
        }

        await db.updateJob(job.id, { status: 'COLLECTING_QUOTES' });
        await db.logStateTransition(job.id, 'READY_FOR_RFQ', 'COLLECTING_QUOTES', 'user', `Sent to ${selected.length} contractors`);

        res.json({ ok: true, contractors_sent: selected.length, contractors: selected.map(c => c.name) });
    } catch (err) {
        console.error('Send to contractors error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Receive contractor reply (simulated webhook for testing)
app.post('/api/jobs/:id/contractor-reply', async (req, res) => {
    try {
        const { contractor_id, reply_text } = req.body;
        const jobId = req.params.id;

        const parsed = await parseQuote(reply_text);

        const quote = await db.createQuote({
            job_id: jobId,
            contractor_id,
            raw_reply: reply_text,
            price: parsed.price,
            currency: parsed.currency,
            vat_included: parsed.vat_included,
            labour_cost: parsed.labour_cost,
            material_cost: parsed.material_cost,
            transport_cost: parsed.transport_cost,
            disposal_cost: parsed.disposal_cost,
            earliest_start: parsed.earliest_start,
            duration_days: parsed.duration_days,
            duration_text: parsed.duration_text,
            materials_included: parsed.materials_included,
            disposal_included: parsed.disposal_included,
            rot_eligible: parsed.rot_eligible,
            is_complete_quote: parsed.is_complete_quote,
            needs_clarification: !parsed.is_complete_quote || parsed.missing_info.length > 0,
            clarification_reason: parsed.missing_info.join(', '),
            human_approved: false
        });

        res.json({ ok: true, quote });
    } catch (err) {
        console.error('Contractor reply error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Approve quote (human review)
app.post('/api/quotes/:id/approve', async (req, res) => {
    try {
        await db.updateQuote(req.params.id, { human_approved: true, needs_clarification: false });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Request clarification from contractor
app.post('/api/quotes/:id/clarify', async (req, res) => {
    try {
        const quote = await db.getQuote(req.params.id);
        if (!quote) return res.status(404).json({ error: 'Quote not found' });

        const contractor = await db.getContractor(quote.contractor_id);

        const clarificationText = `Hej! Tack för din offert på jobb #${quote.job_id.slice(0, 8)}. 

Innan jag kan vidarebefordra den till kunden behöver jag lite mer information:

${quote.clarification_reason || 'Kan du specificera priset, startdatum och vad som ingår?'}

Tack på förhand!`;

        if (contractor?.whatsapp) {
            await twilio.messages.create({
                from: process.env.TWILIO_WHATSAPP_NUMBER,
                to: contractor.whatsapp,
                body: clarificationText
            });
        }

        await db.updateQuote(req.params.id, { clarification_sent: true });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send comparison to customer
app.post('/api/jobs/:id/send-comparison', async (req, res) => {
    try {
        const job = await db.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const quotes = await db.getApprovedQuotesForJob(job.id);
        if (quotes.length === 0) {
            return res.status(400).json({ error: 'No approved quotes to send' });
        }

        let text = `📋 *Vi har fått in ${quotes.length} ${quotes.length === 1 ? 'offert' : 'offerter'} för ditt ${job.category || 'jobb'}:*\n\n`;

        const labels = ['A', 'B', 'C'];
        quotes.forEach((q, i) => {
            const label = labels[i] || String(i + 1);
            const priceDisplay = q.price ? `${q.price.toLocaleString('sv-SE')} SEK` : 'Ej angivet';
            const vatText = q.vat_included === true ? 'inkl. moms' : q.vat_included === false ? 'exkl. moms' : '';

            text += `*Offert ${label} — ${q.contractor_name}*\n`;
            text += `💰 ${priceDisplay} ${vatText}\n`;
            text += `📅 Start: ${q.earliest_start || 'Ej angivet'}\n`;
            text += `⏱️ ${q.duration_days ? q.duration_days + ' dagar' : q.duration_text || 'Ej angivet'}\n`;
            text += `📦 Material: ${q.materials_included === true ? 'Inkluderat' : q.materials_included === false ? 'Ej inkluderat' : 'Ej angivet'}\n`;
            text += `🗑️ Bortforsling: ${q.disposal_included === true ? 'Inkluderat' : q.disposal_included === false ? 'Ej inkluderat' : 'Ej angivet'}\n\n`;
        });

        text += `Välj offert genom att svara med bokstaven (${labels.slice(0, quotes.length).join(', ')}) eller skriv *"mer info [bokstav]"* för detaljer.`;

        await twilio.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: job.customer_phone,
            body: text
        });

        await db.updateJob(job.id, { status: 'CUSTOMER_REVIEW' });
        await db.logStateTransition(job.id, 'COLLECTING_QUOTES', 'CUSTOMER_REVIEW', 'user', 'Comparison sent to customer');

        res.json({ ok: true, quotes_sent: quotes.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Customer selects a quote
app.post('/api/jobs/:id/award', async (req, res) => {
    try {
        const { quote_id } = req.body;
        const job = await db.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const { rows } = await pool.query(
            `SELECT q.*, c.name as contractor_name, c.whatsapp as contractor_whatsapp
             FROM quotes q
             JOIN contractors c ON q.contractor_id = c.id
             WHERE q.id = $1`,
            [quote_id]
        );
        const quote = rows[0];
        if (!quote) return res.status(404).json({ error: 'Quote not found' });

        const commission = calculateCommission(quote.price);

        await db.updateJob(job.id, {
            status: 'AWARDED',
            awarded_to: quote.contractor_id,
            order_value: quote.price,
            commission: commission
        });

        await db.logStateTransition(job.id, 'CUSTOMER_REVIEW', 'AWARDED', 'customer', `Customer selected quote from ${quote.contractor_name}`);

        // Notify contractor
        const contractorMsg = `🎉 *Jobb tilldelat!*

Jobb #${job.job_number}
Kontraktsvärde: ${quote.price?.toLocaleString('sv-SE')} SEK
Plattformsarvode: ${commission.toLocaleString('sv-SE')} SEK

Kundens kontaktuppgifter kommer inom kort.`;

        if (quote.contractor_whatsapp) {
            await twilio.messages.create({
                from: process.env.TWILIO_WHATSAPP_NUMBER,
                to: quote.contractor_whatsapp,
                body: contractorMsg
            });
        }

        // Notify customer
        const customerMsg = `✅ *Bekräftat!*

Du har valt ${quote.contractor_name} för ditt ${job.category || 'jobb'}.
Pris: ${quote.price?.toLocaleString('sv-SE')} SEK
Beräknad start: ${quote.earliest_start || 'Ej angivet'}

Hantverkaren kontaktar dig inom 24 timmar.`;

        await twilio.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: job.customer_phone,
            body: customerMsg
        });

        res.json({ ok: true, commission });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Seed contractors
app.post('/api/seed-contractors', async (req, res) => {
    try {
        await db.seedContractors();
        res.json({ ok: true, message: 'Contractors seeded' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// DASHBOARD
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard/index.html'));
});

app.get('/job/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard/index.html'));
});

// Static assets
app.use('/dashboard-assets', express.static(path.join(__dirname, 'dashboard/assets')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Homefix MVP running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`📱 WhatsApp webhook: http://localhost:${PORT}/webhook/whatsapp`);
});

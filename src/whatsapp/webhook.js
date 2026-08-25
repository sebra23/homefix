import pkg from 'twilio';
const { Twilio } = pkg;
import { extractJob } from '../ai/extractJob.js';
import { checkMissing, generateMissingQuestions } from '../ai/checkMissing.js';
import { db } from '../db/jobs.js';
import { uploadMedia } from './media.js';

const twilioClient = new Twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

export async function handleWebhook(req, res) {
    const { From, Body, NumMedia, MessageSid, ProfileName } = req.body;

    try {
        // 1. DOWNLOAD MEDIA FIRST — URLs expire in ~5 minutes
        const mediaUrls = [];
        const mediaTypes = [];

        for (let i = 0; i < parseInt(NumMedia || 0); i++) {
            const url = req.body[`MediaUrl${i}`];
            const contentType = req.body[`MediaContentType${i}`];
            try {
                const r2Url = await uploadMedia(url, contentType, MessageSid);
                mediaUrls.push(r2Url);
                mediaTypes.push(contentType);
            } catch (err) {
                console.error('Media upload failed:', err.message);
            }
        }

        // 2. Find or create customer
        let customer = await db.getCustomerByPhone(From);
        if (!customer) {
            customer = await db.createCustomer({ 
                phone: From, 
                name: ProfileName || null 
            });
        }

        // 3. Find active job or create new
        let job = await db.getActiveJobForCustomer(customer.id);
        const isNewJob = !job;

        if (isNewJob) {
            job = await db.createJob({ 
                customer_id: customer.id, 
                status: 'COLLECTING_INFORMATION',
                photos: [],
                videos: [],
                voice_notes: []
            });
            await db.logStateTransition(job.id, null, 'COLLECTING_INFORMATION', 'system', 'New job from WhatsApp');
        }

        // 4. Store the incoming message
        await db.createMessage({
            job_id: job.id,
            direction: 'inbound',
            channel: 'whatsapp',
            from_number: From,
            body: Body || null,
            media_urls: mediaUrls,
            raw_payload: req.body
        });

        // 5. Categorize media by type
        const imageUrls = [];
        const videoUrls = [];
        const voiceUrls = [];

        for (let i = 0; i < mediaTypes.length; i++) {
            const type = mediaTypes[i];
            const url = mediaUrls[i];
            if (type?.startsWith('image/')) imageUrls.push(url);
            else if (type?.startsWith('video/')) videoUrls.push(url);
            else if (type?.startsWith('audio/') || type === 'audio/ogg') voiceUrls.push(url);
        }

        // 6. AI extraction
        const extracted = await extractJob({
            previousJob: job,
            messageText: Body,
            imageUrls,
            audioTranscription: null // Skip for MVP speed
        });

        // 7. Merge extracted data into job
        const updates = {};
        if (extracted.category && !job.category) updates.category = extracted.category;
        if (extracted.description) updates.description = extracted.description;
        if (extracted.address && !job.address) updates.address = extracted.address;
        if (extracted.postcode && !job.postcode) updates.postcode = extracted.postcode;
        if (extracted.estimated_size && !job.estimated_size) updates.estimated_size = extracted.estimated_size;
        if (extracted.requested_date && !job.requested_date) updates.requested_date = extracted.requested_date;
        if (extracted.rot_eligible !== undefined) updates.rot_eligible = extracted.rot_eligible;
        if (extracted.rut_eligible !== undefined) updates.rut_eligible = extracted.rut_eligible;
        if (extracted.materials_included !== undefined) updates.materials_included = extracted.materials_included;

        if (imageUrls.length) updates.photos = [...(job.photos || []), ...imageUrls];
        if (videoUrls.length) updates.videos = [...(job.videos || []), ...videoUrls];
        if (voiceUrls.length) updates.voice_notes = [...(job.voice_notes || []), ...voiceUrls];

        if (Object.keys(updates).length > 0) {
            await db.updateJob(job.id, updates);
        }

        // 8. Check what's missing
        const updatedJob = await db.getJob(job.id);
        const missing = checkMissing(updatedJob);

        let replyText;
        if (missing.length === 0) {
            // Job complete — move to READY_FOR_RFQ
            await db.updateJob(job.id, { status: 'READY_FOR_RFQ' });
            await db.logStateTransition(job.id, 'COLLECTING_INFORMATION', 'READY_FOR_RFQ', 'ai', 'All required fields collected');

            replyText = `Tack ${customer.name || ''}! Jag har nu all information jag behöver för ditt ${updatedJob.category}-jobb.

📋 *Sammanfattning:*
${updatedJob.description}
📍 Adress: ${updatedJob.address}${updatedJob.postcode ? ', ' + updatedJob.postcode : ''}
📐 Storlek: ${updatedJob.estimated_size || 'Ej angivet'}
📅 Önskat datum: ${updatedJob.requested_date || 'Ej angivet'}

Jag kontaktar nu lämpliga hantverkare och återkommer med offerter inom 24 timmar.`;
        } else {
            const questions = generateMissingQuestions(missing);
            replyText = questions.join('\n\n');
        }

        // 9. Send reply via Twilio
        await twilioClient.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: From,
            body: replyText
        });

        await db.createMessage({
            job_id: job.id,
            direction: 'outbound',
            channel: 'whatsapp',
            to_number: From,
            body: replyText
        });

        res.status(200).send('<Response></Response>');

    } catch (err) {
        console.error('Webhook error:', err.stack || err.message || err);
        // Send fallback message
        try {
            await twilioClient.messages.create({
                from: process.env.TWILIO_WHATSAPP_NUMBER,
                to: From,
                body: 'Ursäkta, något gick fel. En människa tittar på detta inom kort.'
            });
        } catch {}
        res.status(200).send('<Response></Response>');
    }
}

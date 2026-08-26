import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let __dirname = '';
try {
    const __filename = fileURLToPath(import.meta.url);
    __dirname = path.dirname(__filename);
} catch (e) {
    __dirname = path.resolve();
}

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
    },
});

/**
 * Download media from Twilio and upload to R2, with a robust local storage fallback.
 * CRITICAL: Twilio media URLs expire after ~5 minutes.
 * This MUST run before any AI processing.
 */
export async function uploadMedia(twilioUrl, contentType, messageSid, req) {
    const authHeader = 'Basic ' + Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64');

    const response = await fetch(twilioUrl, {
        headers: { 'Authorization': authHeader },
    });

    if (!response.ok) {
        throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.buffer();
    const extension = contentType.split('/')[1] || 'bin';
    const key = `${messageSid}_${Date.now()}.${extension}`;

    // 1. Try R2 if it is configured (and not dummy)
    const isR2Configured = process.env.R2_ENDPOINT && !process.env.R2_ENDPOINT.includes('dummy');
    if (isR2Configured) {
        try {
            await r2.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET,
                Key: `media/${key}`,
                Body: buffer,
                ContentType: contentType,
            }));
            return `${process.env.R2_PUBLIC_URL}/media/${key}`;
        } catch (err) {
            console.error('R2 upload failed, falling back to local file storage:', err.message || err);
        }
    }

    // 2. Local Fallback: Save buffer to /src/uploads/
    try {
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const filePath = path.join(uploadsDir, key);
        fs.writeFileSync(filePath, buffer);

        const host = req ? req.get('host') : 'localhost:3000';
        const protocol = req ? (req.headers['x-forwarded-proto'] || req.protocol) : 'http';
        return `${protocol}://${host}/uploads/${key}`;
    } catch (err) {
        console.error('Local file write failed:', err.message || err);
        throw err;
    }
}

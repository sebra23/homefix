import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fetch from 'node-fetch';

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
    },
});

/**
 * Download media from Twilio and upload to R2.
 * CRITICAL: Twilio media URLs expire after ~5 minutes.
 * This MUST run before any AI processing.
 */
export async function uploadMedia(twilioUrl, contentType, messageSid) {
    const authHeader = 'Basic ' + Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64');

    const response = await fetch(twilioUrl, {
        headers: { 'Authorization': authHeader },
    });

    if (!response.ok) {
        throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.buffer();
    const extension = contentType.split('/')[1] || 'bin';
    const key = `media/${messageSid}/${Date.now()}.${extension}`;

    await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    }));

    return `${process.env.R2_PUBLIC_URL}/${key}`;
}

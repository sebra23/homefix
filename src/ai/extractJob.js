import { z } from 'zod';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const JobExtractionSchema = z.object({
    category: z.enum(['painting', 'plumbing', 'electrical', 'carpentry', 'roofing', 'tiling', 'other']).nullable().optional(),
    description: z.string().nullable().optional(),
    estimated_size: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    postcode: z.string().nullable().optional(),
    requested_date: z.string().nullable().optional(),
    rot_eligible: z.boolean().nullable().optional(),
    rut_eligible: z.boolean().nullable().optional(),
    materials_included: z.boolean().nullable().optional(),
    problem_summary: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    new_facts: z.array(z.string()).nullable().optional(),
});

export async function extractJob({ previousJob, messageText, imageUrls, audioTranscription }) {
    const systemPrompt = `Du är en AI-assistent för en svensk hantverksförmedling. Din uppgift är att extrahera strukturerad information ur kundmeddelanden om renoverings- och reparationsjobb.

Regler:
- Returnera alltid giltig JSON.
- Adress och postnummer är kritiska. Om de saknas, notera det tydligt.
- ROT-avdrag gäller för reparationer och ombyggnad på privatbostad. Nyproduktion gäller INTE.
- RUT-avdrag gäller för städning, trädgårdsarbete, IT-support, etc.
- Separera alltid arbetskostnad från materialkostnad om kunden nämner priser.
- Svara på svenska om kunden skriver på svenska.
- confidence < 0.7 betyder att du gissar — flagga det.

Kategorier:
- painting: målning (inomhus/utomhus)
- plumbing: VVS, rör, vatten, avlopp
- electrical: elinstallationer
- carpentry: snickeri, träarbete, altaner, golv
- roofing: takarbete
- tiling: kakel, klinker, plattsättning
- other: övrigt

Format på JSON-svar:
{
  "category": "painting" | "plumbing" | "electrical" | "carpentry" | "roofing" | "tiling" | "other" | null,
  "description": "beskrivning av jobbet",
  "estimated_size": "storlek" | null,
  "address": "adress" | null,
  "postcode": "postnummer" | null,
  "requested_date": "önskat datum" | null,
  "rot_eligible": true | false | null,
  "rut_eligible": true | false | null,
  "materials_included": true | false | null,
  "problem_summary": "sammanfattning av problemet",
  "confidence": 0.0 - 1.0,
  "new_facts": ["faktum 1", "faktum 2"]
}`;

    const userContent = [];

    if (messageText) {
        userContent.push({ type: 'text', text: messageText });
    }

    if (audioTranscription) {
        userContent.push({ type: 'text', text: `[Röstmeddelande: ${audioTranscription}]` });
    }

    for (const url of imageUrls || []) {
        userContent.push({
            type: 'image_url',
            image_url: { url, detail: 'low' }
        });
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: [
                ...userContent,
                { type: 'text', text: `Tidigare jobbdata: ${JSON.stringify(previousJob || {})}` }
            ]
        }
    ];

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.2,
    });

    const raw = JSON.parse(completion.choices[0].message.content);
    const parsed = JobExtractionSchema.parse(raw);
    return parsed;
}

import { z } from 'zod';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const QuoteSchema = z.object({
    price: z.number().nullable(),
    currency: z.string().default('SEK'),
    vat_included: z.boolean().nullable(),
    labour_cost: z.number().nullable(),
    material_cost: z.number().nullable(),
    transport_cost: z.number().nullable(),
    disposal_cost: z.number().nullable(),
    earliest_start: z.string().nullable(),
    duration_days: z.number().nullable(),
    duration_text: z.string().nullable(),
    materials_included: z.boolean().nullable(),
    disposal_included: z.boolean().nullable(),
    rot_eligible: z.boolean().nullable(),
    is_complete_quote: z.boolean(),
    missing_info: z.array(z.string()),
    notes: z.string(),
});

export async function parseQuote(contractorReply) {
    const systemPrompt = `Du är en AI som extraherar offertinformation ur informella svar från svenska hantverkare.

Regler:
- "inkl moms", "inkl. moms", "inklusive moms" = moms ingår (vat_included: true)
- "exkl moms", "exkl. moms", "exklusive moms" = moms ingår ej (vat_included: false)
- "v 38", "vecka 38" = vecka 38. Konvertera till ungefärligt datum om möjligt.
- "17-18 000" eller "17-18k" = notera som intervall, välj mittvärdet eller det högre.
- Om svaret är för vagt, sätt is_complete_quote = false och lista vad som saknas.
- Separera arbetskostnad från materialkostnad om det nämns.
- ROT-avdrag: om hantverkaren bekräftar att arbetet är ROT-kvalificerat.

Returnera alltid giltig JSON.`;

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: contractorReply }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
    });

    const raw = JSON.parse(completion.choices[0].message.content);
    return QuoteSchema.parse(raw);
}

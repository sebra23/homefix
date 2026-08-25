export const CATEGORY_RULES = {
    painting: ['address', 'postcode', 'interior_or_exterior', 'approx_sqm', 'num_rooms', 'surface_condition', 'desired_finish', 'materials_included', 'requested_date'],
    plumbing: ['address', 'postcode', 'problem_type', 'urgency', 'requested_date'],
    electrical: ['address', 'postcode', 'work_type', 'requested_date'],
    carpentry: ['address', 'postcode', 'approx_sqm', 'materials_included', 'disposal_needed', 'requested_date'],
    roofing: ['address', 'postcode', 'roof_type', 'problem_description', 'approx_sqm', 'requested_date'],
    tiling: ['address', 'postcode', 'room_type', 'approx_sqm', 'materials_included', 'requested_date'],
    other: ['address', 'postcode', 'description', 'requested_date'],
};

export const QUESTIONS = {
    address: 'Vad är adressen där arbetet ska utföras?',
    postcode: 'Vilket postnummer har fastigheten?',
    approx_sqm: 'Ungefär hur många kvadratmeter handlar det om?',
    materials_included: 'Ska hantverkaren stå för material, eller har du eget?',
    requested_date: 'När vill du att arbetet ska påbörjas?',
    interior_or_exterior: 'Är det inomhus- eller utomhusmålning?',
    num_rooms: 'Hur många rum ska målas?',
    surface_condition: 'Hur ser ytan ut idag? (slät, sliten, tidigare målad, etc.)',
    desired_finish: 'Vilken typ av finish önskar du? (matt, halvblank, etc.)',
    problem_type: 'Vad är problemet? (läcka, stopp, installation, etc.)',
    urgency: 'Är det akut eller kan det vänta?',
    work_type: 'Vilken typ av elarbete? (installation, reparation, utbyte)',
    disposal_needed: 'Ska gammalt material tas omhand?',
    roof_type: 'Vilken typ av tak? (tegel, plåt, papptak, etc.)',
    problem_description: 'Beskriv problemet med taket.',
    room_type: 'Vilket rum? (badrum, kök, hall, etc.)',
    description: 'Kan du beskriva arbetet närmare?',
};

export function checkMissing(job) {
    const rules = CATEGORY_RULES[job.category] || CATEGORY_RULES.other;
    const missing = [];

    for (const field of rules) {
        const value = job[field];
        if (value === null || value === undefined || value === '') {
            missing.push(field);
        }
    }

    return missing;
}

export function generateMissingQuestions(missing) {
    return missing.map(field => QUESTIONS[field] || `Kan du berätta mer om ${field}?`);
}

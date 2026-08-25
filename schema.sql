-- Enable PostGIS for geospatial (optional for MVP, ready for later)
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TYPE job_status AS ENUM (
    'NEW',
    'COLLECTING_INFORMATION',
    'READY_FOR_RFQ',
    'MATCHING_CONTRACTORS',
    'AWAITING_COMMISSION_ACCEPTANCE',
    'REQUESTING_QUOTES',
    'COLLECTING_QUOTES',
    'READY_FOR_CUSTOMER',
    'CUSTOMER_REVIEW',
    'AWARDED',
    'WORK_SCHEDULED',
    'COMPLETED',
    'COMMISSION_DUE',
    'CLOSED',
    'NEEDS_REVIEW'
);

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_number SERIAL,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,

    -- Location
    address TEXT,
    postcode TEXT,
    location_geom GEOMETRY(POINT, 4326),

    -- Job details
    category TEXT,
    description TEXT,
    estimated_size TEXT,

    -- Media (R2 URLs)
    photos TEXT[] DEFAULT '{}',
    videos TEXT[] DEFAULT '{}',
    voice_notes TEXT[] DEFAULT '{}',

    -- Timing
    requested_date TEXT,

    -- RUT/ROT
    rot_eligible BOOLEAN,
    rut_eligible BOOLEAN,

    -- State machine
    status job_status DEFAULT 'NEW',

    -- Award
    awarded_to UUID,
    order_value INTEGER,
    commission INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    direction TEXT CHECK (direction IN ('inbound', 'outbound')),
    channel TEXT CHECK (channel IN ('whatsapp', 'email', 'sms')),
    from_number TEXT,
    to_number TEXT,
    body TEXT,
    media_urls TEXT[] DEFAULT '{}',
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contractors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    company_name TEXT,
    services TEXT[] DEFAULT '{}',
    areas TEXT[] DEFAULT '{}',
    max_radius_km INTEGER DEFAULT 40,
    email TEXT,
    whatsapp TEXT,
    sms TEXT,

    -- Swedish requirements
    f_tax_verified BOOLEAN DEFAULT FALSE,
    rot_approved BOOLEAN DEFAULT FALSE,
    rut_approved BOOLEAN DEFAULT FALSE,
    liability_insurance_verified BOOLEAN DEFAULT FALSE,

    -- Commission terms
    commission_accepted BOOLEAN DEFAULT FALSE,
    commission_terms_version TEXT,
    commission_accepted_at TIMESTAMPTZ,

    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,

    -- Structured quote
    price INTEGER,
    currency TEXT DEFAULT 'SEK',
    vat_included BOOLEAN,
    labour_cost INTEGER,
    material_cost INTEGER,
    transport_cost INTEGER,
    disposal_cost INTEGER,

    earliest_start TEXT,
    duration_days INTEGER,
    duration_text TEXT,

    materials_included BOOLEAN,
    disposal_included BOOLEAN,
    rot_eligible BOOLEAN,

    -- Review
    raw_reply TEXT,
    structured_by_ai BOOLEAN DEFAULT TRUE,
    human_approved BOOLEAN DEFAULT FALSE,
    needs_clarification BOOLEAN DEFAULT FALSE,
    clarification_sent BOOLEAN DEFAULT FALSE,
    clarification_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS state_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    from_status job_status,
    to_status job_status,
    triggered_by TEXT CHECK (triggered_by IN ('ai', 'system', 'user', 'contractor', 'customer')),
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_messages_job ON messages(job_id);
CREATE INDEX IF NOT EXISTS idx_quotes_job ON quotes(job_id);
CREATE INDEX IF NOT EXISTS idx_contractors_services ON contractors USING GIN(services);
CREATE INDEX IF NOT EXISTS idx_contractors_areas ON contractors USING GIN(areas);

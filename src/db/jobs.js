import { pool } from '../config/database.js';

export const db = {
    // Customers
    async getCustomerByPhone(phone) {
        const { rows } = await pool.query('SELECT * FROM customers WHERE phone = $1', [phone]);
        return rows[0] || null;
    },

    async createCustomer({ phone, name }) {
        const { rows } = await pool.query(
            'INSERT INTO customers (phone, name) VALUES ($1, $2) RETURNING *',
            [phone, name]
        );
        return rows[0];
    },

    // Jobs
    async getJob(id) {
        const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
        return rows[0] || null;
    },

    async getActiveJobForCustomer(customerId) {
        const { rows } = await pool.query(
            `SELECT * FROM jobs 
             WHERE customer_id = $1 
             AND status NOT IN ('AWARDED', 'COMPLETED', 'CLOSED', 'COMMISSION_DUE')
             ORDER BY created_at DESC LIMIT 1`,
            [customerId]
        );
        return rows[0] || null;
    },

    async createJob({ customer_id, status, photos, videos, voice_notes }) {
        const { rows } = await pool.query(
            `INSERT INTO jobs (customer_id, status, photos, videos, voice_notes) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [customer_id, status, photos || [], videos || [], voice_notes || []]
        );
        return rows[0];
    },

    async updateJob(id, updates) {
        const fields = [];
        const values = [];
        let i = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                fields.push(`${key} = $${i}`);
                values.push(value);
                i++;
            }
        }

        if (fields.length === 0) return;

        values.push(id);
        const query = `UPDATE jobs SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`;
        const { rows } = await pool.query(query, values);
        return rows[0];
    },

    async getJobsWithQuotes() {
        const { rows } = await pool.query(`
            SELECT 
                j.*,
                c.name as customer_name,
                c.phone as customer_phone,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', q.id,
                            'contractor_id', q.contractor_id,
                            'contractor_name', co.name,
                            'price', q.price,
                            'currency', q.currency,
                            'vat_included', q.vat_included,
                            'labour_cost', q.labour_cost,
                            'material_cost', q.material_cost,
                            'transport_cost', q.transport_cost,
                            'disposal_cost', q.disposal_cost,
                            'earliest_start', q.earliest_start,
                            'duration_days', q.duration_days,
                            'duration_text', q.duration_text,
                            'materials_included', q.materials_included,
                            'disposal_included', q.disposal_included,
                            'raw_reply', q.raw_reply,
                            'human_approved', q.human_approved,
                            'needs_clarification', q.needs_clarification,
                            'clarification_reason', q.clarification_reason,
                            'created_at', q.created_at
                        ) ORDER BY q.created_at
                    ) FILTER (WHERE q.id IS NOT NULL),
                    '[]'
                ) as quotes
            FROM jobs j
            LEFT JOIN customers c ON j.customer_id = c.id
            LEFT JOIN quotes q ON j.id = q.job_id
            LEFT JOIN contractors co ON q.contractor_id = co.id
            GROUP BY j.id, c.name, c.phone
            ORDER BY j.created_at DESC
        `);
        return rows;
    },

    // Messages
    async createMessage({ job_id, direction, channel, from_number, to_number, body, media_urls, raw_payload }) {
        const { rows } = await pool.query(
            `INSERT INTO messages (job_id, direction, channel, from_number, to_number, body, media_urls, raw_payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [job_id, direction, channel, from_number, to_number, body, media_urls || [], raw_payload || null]
        );
        return rows[0];
    },

    // Contractors
    async findContractorsForJob(category, postcode) {
        const { rows } = await pool.query(
            `SELECT * FROM contractors 
             WHERE active = true 
             AND ($1 = ANY(services) OR services = '{}')
             AND ($2 = ANY(areas) OR areas = '{}')
             ORDER BY created_at DESC
             LIMIT 10`,
            [category, postcode]
        );
        return rows;
    },

    async getContractor(id) {
        const { rows } = await pool.query('SELECT * FROM contractors WHERE id = $1', [id]);
        return rows[0] || null;
    },

    async seedContractors() {
        const contractors = [
            {
                name: 'Anders Andersson',
                company_name: 'Anderssons Bygg AB',
                services: ['carpentry', 'tiling'],
                areas: ['18334', '18335', '18336', 'Täby', 'Danderyd'],
                email: 'anders@anderssonsbygg.se',
                whatsapp: '+46701234567',
                f_tax_verified: true,
                rot_approved: true,
                active: true
            },
            {
                name: 'Lisa Lindgren',
                company_name: 'Täby Snickeri',
                services: ['carpentry', 'painting'],
                areas: ['18334', '18335', 'Täby', 'Solna'],
                email: 'lisa@tabysnickeri.se',
                whatsapp: '+46702345678',
                f_tax_verified: true,
                rot_approved: true,
                active: true
            },
            {
                name: 'Nils Nordström',
                company_name: 'Nordbygg Stockholm',
                services: ['carpentry', 'roofing', 'tiling'],
                areas: ['18334', '18335', '18336', 'Täby', 'Stockholm'],
                email: 'nils@nordbygg.se',
                whatsapp: '+46703456789',
                f_tax_verified: true,
                rot_approved: true,
                active: true
            }
        ];

        for (const c of contractors) {
            await pool.query(
                `INSERT INTO contractors (name, company_name, services, areas, email, whatsapp, f_tax_verified, rot_approved, active)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT DO NOTHING`,
                [c.name, c.company_name, c.services, c.areas, c.email, c.whatsapp, c.f_tax_verified, c.rot_approved, c.active]
            );
        }
    },

    // Quotes
    async createQuote(data) {
        const { rows } = await pool.query(
            `INSERT INTO quotes (
                job_id, contractor_id, price, currency, vat_included, 
                labour_cost, material_cost, transport_cost, disposal_cost,
                earliest_start, duration_days, duration_text,
                materials_included, disposal_included, rot_eligible,
                raw_reply, structured_by_ai, human_approved, needs_clarification, clarification_reason
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING *`,
            [
                data.job_id, data.contractor_id, data.price, data.currency || 'SEK', data.vat_included,
                data.labour_cost, data.material_cost, data.transport_cost, data.disposal_cost,
                data.earliest_start, data.duration_days, data.duration_text,
                data.materials_included, data.disposal_included, data.rot_eligible,
                data.raw_reply, data.structured_by_ai ?? true, data.human_approved ?? false,
                data.needs_clarification ?? false, data.clarification_reason
            ]
        );
        return rows[0];
    },

    async updateQuote(id, updates) {
        const fields = [];
        const values = [];
        let i = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                fields.push(`${key} = $${i}`);
                values.push(value);
                i++;
            }
        }

        if (fields.length === 0) return;

        values.push(id);
        const query = `UPDATE quotes SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`;
        const { rows } = await pool.query(query, values);
        return rows[0];
    },

    async getQuote(id) {
        const { rows } = await pool.query('SELECT * FROM quotes WHERE id = $1', [id]);
        return rows[0] || null;
    },

    async getApprovedQuotesForJob(jobId) {
        const { rows } = await pool.query(`
            SELECT q.*, c.name as contractor_name, c.company_name
            FROM quotes q
            JOIN contractors c ON q.contractor_id = c.id
            WHERE q.job_id = $1 AND q.human_approved = true
            ORDER BY q.price ASC
        `, [jobId]);
        return rows;
    },

    // State transitions
    async logStateTransition(jobId, fromStatus, toStatus, triggeredBy, reason) {
        await pool.query(
            `INSERT INTO state_transitions (job_id, from_status, to_status, triggered_by, reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [jobId, fromStatus, toStatus, triggeredBy, reason]
        );
    }
};

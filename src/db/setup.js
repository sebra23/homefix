import fs from 'fs';
import { pool } from '../config/database.js';

export async function setupDatabase() {
    const schema = fs.readFileSync('./schema.sql', 'utf8');
    await pool.query(schema);
    console.log('Database schema applied successfully');
    await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    setupDatabase().catch(console.error);
}

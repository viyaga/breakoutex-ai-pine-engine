import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
    throw new Error('CRITICAL: .env file is missing! Copy .env.example to .env and fill in values.');
}
dotenv.config();

const requiredVars = ['MONGO_URI', 'EXCHANGE_KEYS_ENCRYPTION_KEY', 'PAYLOAD_URL'];
const missing = requiredVars.filter(v => !process.env[v]);
if (missing.length) {
    throw new Error(`CRITICAL: Missing env vars: ${missing.join(', ')}`);
}

const env = {
    port:            parseInt(process.env.PORT || '3002', 10),
    mongoUri:        process.env.MONGO_URI!,
    cronSchedule:    process.env.CRON_SCHEDULE || '* * * * *',
    payloadUrl:      process.env.PAYLOAD_URL!,
    serverIp:        process.env.SERVER_IP || '127.0.0.1',
    encryptionKey:   process.env.EXCHANGE_KEYS_ENCRYPTION_KEY!,
    concurrency:     parseInt(process.env.CONCURRENCY || '3', 10),
    dryRun:          process.env.DRY_RUN === 'true',
    geminiApiKey:    process.env.GEMINI_API_KEY || '',
    geminiModel:     process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
};

export default env;


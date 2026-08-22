import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import connectDB from './config/db';
import env from './config/env';
import { startCronJob } from './cron/index';
import pineRoutes from './routes/pine.routes';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/api/pine', pineRoutes);

// Startup
(async () => {
    await connectDB();
    startCronJob();
    app.listen(env.port, () => {
        console.log(`\n[Server] Pine Engine running on port ${env.port}`);
        console.log(`[Server] Health: http://localhost:${env.port}/api/pine/health`);
        console.log(`[Server] Trigger: POST http://localhost:${env.port}/api/pine/trigger`);
        console.log(`[Server] Evaluate: POST http://localhost:${env.port}/api/pine/evaluate\n`);
    });
})();

process.on('uncaughtException',  err => console.error('[Process] uncaughtException:', err));
process.on('unhandledRejection', err => console.error('[Process] unhandledRejection:', err));

import crypto from 'crypto';
import env from '../config/env';

const ALGO = 'aes-256-cbc';

export function decrypt(encrypted: string): string {
    try {
        if (!encrypted || !encrypted.includes(':')) return encrypted;
        const [ivHex, encHex] = encrypted.split(':');
        const iv  = Buffer.from(ivHex,  'hex');
        const enc = Buffer.from(encHex, 'hex');
        const key = Buffer.from(env.encryptionKey, 'hex');
        const decipher = crypto.createDecipheriv(ALGO, key, iv);
        return decipher.update(enc) + decipher.final('utf8');
    } catch {
        // Already plain text (local testing)
        return encrypted;
    }
}

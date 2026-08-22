import mongoose from 'mongoose';
import env from './env';

const connectDB = async (): Promise<void> => {
    try {
        await mongoose.connect(env.mongoUri);
        console.log('[DB] MongoDB connected');
    } catch (err) {
        console.error('[DB] Connection error:', err);
    }
};

export default connectDB;

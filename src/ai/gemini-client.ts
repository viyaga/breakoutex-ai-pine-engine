// ================================================================
// Direct Gemini AI Client for Pine Engine
// Uses @google/generative-ai SDK with multi-model fallback cascade
// and direct REST fallback for ultimate reliability.
// ================================================================

import {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} from '@google/generative-ai';
import env from '../config/env';

export type GeminiModelId =
    | 'gemini-3.5-flash-lite'
    | 'gemini-3.1-flash-lite'
    | 'gemini-3.5-flash'
    | 'gemini-3.6-flash'
    | 'gemini-3.7-flash';

export interface GeminiGenerationOptions {
    prompt: string;
    systemInstruction?: string;
    model?: string;
    apiKey?: string;
    temperature?: number;
}

const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export const OFFICIAL_MODELS: GeminiModelId[] = [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
];

const MODEL_ALIASES: Record<string, GeminiModelId> = {
    'gemini-3.5-flash-lite': 'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite',
    'gemini-3.5-flash': 'gemini-3.5-flash',
    'gemini-3.6-flash': 'gemini-3.6-flash',
    'gemini-3.7-flash': 'gemini-3.7-flash',
    'gemini-2.5-flash': 'gemini-3.5-flash-lite',
    'gemini-2.0-flash': 'gemini-3.5-flash-lite',
    'gemini-1.5-flash': 'gemini-3.5-flash-lite',
};

export function resolveModelId(modelId?: string): GeminiModelId {
    if (modelId && MODEL_ALIASES[modelId]) {
        return MODEL_ALIASES[modelId];
    }
    return 'gemini-3.5-flash-lite';
}

let _sdkClient: GoogleGenerativeAI | null = null;
let _sdkKey: string = '';

function getGenerativeAISDK(apiKey: string): GoogleGenerativeAI {
    if (!_sdkClient || _sdkKey !== apiKey) {
        _sdkClient = new GoogleGenerativeAI(apiKey);
        _sdkKey = apiKey;
    }
    return _sdkClient;
}

/**
 * Generate text or structured JSON using @google/generative-ai SDK
 * with automatic model fallback cascade across official Gemini models.
 */
export async function generateWithGemini(options: GeminiGenerationOptions): Promise<string> {
    const apiKey = options.apiKey || env.geminiApiKey;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured in pine-engine environment.');
    }

    const genAI = getGenerativeAISDK(apiKey);
    const preferredModel = resolveModelId(options.model || env.geminiModel);
    const modelsToTry: GeminiModelId[] = Array.from(new Set([preferredModel, ...OFFICIAL_MODELS]));

    let lastError: any = null;

    // 1. Try with official @google/generative-ai SDK
    for (const modelId of modelsToTry) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelId,
                safetySettings: SAFETY_SETTINGS,
                generationConfig: {
                    temperature: options.temperature ?? 0.1,
                    topP: 0.8,
                    responseMimeType: 'application/json',
                },
                systemInstruction: options.systemInstruction
                    ? { role: 'system', parts: [{ text: options.systemInstruction }] }
                    : undefined,
            });

            const result = await model.generateContent({
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: options.prompt }],
                    },
                ],
            });

            const response = await result.response;
            const text = response.text();
            if (text && text.trim()) {
                return text.trim();
            }
        } catch (err: any) {
            lastError = err;
            console.warn(`[Gemini SDK] Model "${modelId}" failed (${err?.message}). Trying next fallback model...`);
        }
    }

    // 2. Direct REST fallback if SDK encounters environment issues
    console.warn('[Gemini Client] SDK models failed, attempting direct REST fallback...');
    for (const modelId of modelsToTry) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
                    generationConfig: {
                        temperature: options.temperature ?? 0.1,
                        topP: 0.8,
                        responseMimeType: 'application/json',
                    },
                    ...(options.systemInstruction
                        ? { systemInstruction: { role: 'system', parts: [{ text: options.systemInstruction }] } }
                        : {}),
                }),
                signal: AbortSignal.timeout(15_000),
            });

            if (res.ok) {
                const data = await res.json() as any;
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text && text.trim()) {
                    return text.trim();
                }
            }
        } catch (restErr: any) {
            lastError = restErr;
        }
    }

    throw lastError || new Error('All Gemini SDK and REST fallback models failed.');
}

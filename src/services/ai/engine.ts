/**
 * VelixEngine - Direct HTTP AI provider client for CLI.
 * Makes direct API calls to all 9 AI providers with no intermediate server.
 */

import { ProviderID, ChatMessage } from './types.js';

/** Model ID mapping overrides */
const MODEL_ID_MAP: Record<string, string> = {
    'claude-sonnet-4-6': 'claude-sonnet-4-20250514',
    'claude-opus-4-5': 'claude-opus-4-5-20251101',
    'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
    'gemini-2.5-pro': 'gemini-2.5-pro-preview-06-05',
    'gemini-2.0-flash': 'gemini-2.0-flash-001',
};

function toActualModelID(velixModelID: string): string {
    return MODEL_ID_MAP[velixModelID] ?? velixModelID;
}

/** Provider API endpoint mapping */
function getBaseURL(provider: ProviderID): string {
    const urls: Record<ProviderID, string> = {
        claude: 'https://api.anthropic.com',
        chatgpt: 'https://api.openai.com/v1',
        gemini: 'https://generativelanguage.googleapis.com/v1beta',
        deepseek: 'https://api.deepseek.com/v1',
        groq: 'https://api.groq.com/openai/v1',
        mistral: 'https://api.mistral.ai/v1',
        minimax: 'https://api.minimax.chat/v1',
        kimi: 'https://api.moonshot.cn/v1',
        glm4: 'https://open.bigmodel.cn/api/paas/v4',
    };
    return urls[provider];
}

export interface SendMessageParams {
    text: string;
    system?: string;
    provider: ProviderID;
    model: string;
    apiKey: string;
    messageHistory?: ChatMessage[];
    maxTokens?: number;
    onStream?: (chunk: string) => void;
    signal?: AbortSignal;
}

/**
 * Send a message to any of the 9 AI providers.
 * Returns the full response text.
 */
export async function sendMessage(params: SendMessageParams): Promise<string> {
    const model = toActualModelID(params.model);
    const messages: ChatMessage[] = [
        ...(params.messageHistory ?? []),
        { role: 'user', content: params.text },
    ];
    const maxTokens = params.maxTokens ?? 4096;

    // --- Anthropic Claude ---
    if (params.provider === 'claude') {
        const body: Record<string, unknown> = {
            model,
            max_tokens: maxTokens,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
        };
        if (params.system) {
            body.system = params.system;
        }

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': params.apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: params.signal,
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Anthropic API error (${res.status}): ${err}`);
        }

        const data = await res.json() as { content: Array<{ text: string }> };
        const text = data.content?.[0]?.text ?? '';
        if (params.onStream) params.onStream(text);
        return text;
    }

    // --- Google Gemini ---
    if (params.provider === 'gemini') {
        const geminiMsgs = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));

        const body: Record<string, unknown> = { contents: geminiMsgs };
        if (params.system) {
            body.systemInstruction = { parts: [{ text: params.system }] };
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${params.apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: params.signal,
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Google API error (${res.status}): ${err}`);
        }

        const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (params.onStream) params.onStream(text);
        return text;
    }

    // --- OpenAI-compatible providers ---
    const baseUrl = getBaseURL(params.provider);
    const chatMsgs: Array<{ role: string; content: string }> = [];
    if (params.system) {
        chatMsgs.push({ role: 'system', content: params.system });
    }
    for (const m of messages) {
        chatMsgs.push({ role: m.role, content: m.content });
    }

    const body = {
        model,
        messages: chatMsgs,
        max_tokens: maxTokens,
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: params.signal,
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`${params.provider} API error (${res.status}): ${err}`);
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '';
    if (params.onStream) params.onStream(text);
    return text;
}

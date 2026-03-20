/**
 * VelixEngine - Direct HTTP AI provider client for CLI.
 * Makes direct API calls to all 9 AI providers with no intermediate server.
 */
/** Model ID mapping overrides */
const MODEL_ID_MAP = {
    'claude-sonnet-4-6': 'claude-sonnet-4-20250514',
    'claude-opus-4-5': 'claude-opus-4-5-20251101',
    'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.0-flash': 'gemini-2.0-flash-001',
};
function toActualModelID(velixModelID) {
    return MODEL_ID_MAP[velixModelID] ?? velixModelID;
}
/** Provider API endpoint mapping */
function getBaseURL(provider) {
    const urls = {
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
/**
 * Send a message to any of the 9 AI providers.
 * Returns the full response text.
 */
export async function sendMessage(params) {
    const model = toActualModelID(params.model);
    const messages = [
        ...(params.messageHistory ?? []),
        { role: 'user', content: params.text },
    ];
    const maxTokens = params.maxTokens ?? 4096;
    // --- Anthropic Claude ---
    if (params.provider === 'claude') {
        const body = {
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
            if (res.status === 429) {
                throw new Error('Rate limit exceeded. Please try again later.');
            }
            if (res.status === 401) {
                throw new Error('Invalid API key or authentication failed.');
            }
            const err = await res.text();
            throw new Error(`Anthropic API error (${res.status}): ${err}`);
        }
        const data = await res.json();
        const text = data.content?.[0]?.text ?? '';
        if (params.onStream)
            params.onStream(text);
        return text;
    }
    // --- Google Gemini ---
    if (params.provider === 'gemini') {
        const geminiMsgs = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));
        const body = { contents: geminiMsgs };
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
            if (res.status === 429) {
                throw new Error('Quota exceeded. No balance remaining.');
            }
            const err = await res.text();
            throw new Error(`Google API error (${res.status}): ${err}`);
        }
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (params.onStream)
            params.onStream(text);
        return text;
    }
    // --- OpenAI-compatible providers ---
    const baseUrl = getBaseURL(params.provider);
    const chatMsgs = [];
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
        if (res.status === 429) {
            throw new Error('Rate limit exceeded. Please try again later.');
        }
        if (res.status === 401) {
            throw new Error('Invalid API key or authentication failed.');
        }
        const err = await res.text();
        throw new Error(`${params.provider} API error (${res.status}): ${err}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? '';
    if (params.onStream)
        params.onStream(text);
    return text;
}
//# sourceMappingURL=engine.js.map
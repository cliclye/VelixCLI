// AI Provider types and interfaces
export const PROVIDERS = [
    {
        id: 'claude',
        name: 'Claude (Anthropic)',
        models: ['claude-sonnet-4-6', 'claude-opus-4-5', 'claude-haiku-4-5'],
        envVar: 'ANTHROPIC_API_KEY',
    },
    {
        id: 'chatgpt',
        name: 'ChatGPT (OpenAI)',
        models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o3', 'o4-mini'],
        envVar: 'OPENAI_API_KEY',
    },
    {
        id: 'gemini',
        name: 'Gemini (Google)',
        models: ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
        envVar: 'GEMINI_API_KEY',
    },
    {
        id: 'glm4',
        name: 'GLM (Z.AI Coding Plan)',
        models: ['glm-4.7', 'glm-4.5', 'glm-4-flash'],
        envVar: 'GLM_API_KEY',
    },
    {
        id: 'minimax',
        name: 'MiniMax',
        models: ['MiniMax-M2.5', 'MiniMax-M2.1'],
        envVar: 'MINIMAX_API_KEY',
    },
    {
        id: 'kimi',
        name: 'Kimi (Moonshot AI)',
        models: ['kimi-k2', 'moonshot-v1-32k', 'moonshot-v1-128k'],
        envVar: 'KIMI_API_KEY',
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        models: ['deepseek-chat', 'deepseek-reasoner'],
        envVar: 'DEEPSEEK_API_KEY',
    },
    {
        id: 'groq',
        name: 'Groq (Fast Inference)',
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
        envVar: 'GROQ_API_KEY',
    },
    {
        id: 'mistral',
        name: 'Mistral AI',
        models: ['mistral-small-latest', 'open-mistral-nemo', 'codestral-latest'],
        envVar: 'MISTRAL_API_KEY',
    },
];
//# sourceMappingURL=types.js.map
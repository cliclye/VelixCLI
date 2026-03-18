export type ProviderID = 'claude' | 'chatgpt' | 'gemini' | 'glm4' | 'minimax' | 'kimi' | 'deepseek' | 'groq' | 'mistral';
export interface AIProvider {
    id: ProviderID;
    name: string;
    models: string[];
    envVar: string;
}
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}
export interface AIResponse {
    content: string;
    model: string;
    provider: ProviderID;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
export declare const PROVIDERS: AIProvider[];
//# sourceMappingURL=types.d.ts.map
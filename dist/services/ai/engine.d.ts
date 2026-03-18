/**
 * VelixEngine - Direct HTTP AI provider client for CLI.
 * Makes direct API calls to all 9 AI providers with no intermediate server.
 */
/// <reference types="node" />
import { ProviderID, ChatMessage } from './types.js';
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
export declare function sendMessage(params: SendMessageParams): Promise<string>;
//# sourceMappingURL=engine.d.ts.map
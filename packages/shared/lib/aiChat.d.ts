export interface MediaPart {
    type: 'image' | 'video';
    url: string;
    mimeType: string;
    metadata?: any;
}
export type AIProvider = 'anthropic' | 'google' | 'openai';
export interface AIModelConfig {
    id: string;
    name: string;
    provider: AIProvider;
    description: string;
}
export declare const AVAILABLE_MODELS: AIModelConfig[];
export declare const DEFAULT_MODEL_ID = "claude-sonnet-4-6";
export declare const DEFAULT_MODEL_ID_BY_PROVIDER: Record<AIProvider, string>;
//# sourceMappingURL=aiChat.d.ts.map
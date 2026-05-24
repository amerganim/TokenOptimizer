import { get_encoding, type Tiktoken } from 'tiktoken';

export type EncodingName = 'cl100k_base' | 'o200k_base';

export interface TokenizerSpec {
    encoding: EncodingName;
    accuracy: 'exact' | 'approximate';
    note?: string;
}

// model id → which tiktoken encoding and how accurate it is for that model.
// "exact"        = this encoding is what the model actually uses
// "approximate"  = best-available local approximation (no public tokenizer for the model)
const MODEL_TO_TOKENIZER: Record<string, TokenizerSpec> = {
    'gpt-4o':           { encoding: 'o200k_base',  accuracy: 'exact' },
    'gpt-4o-mini':      { encoding: 'o200k_base',  accuracy: 'exact' },
    'claude-sonnet':    {
        encoding: 'cl100k_base', accuracy: 'approximate',
        note: 'Claude uses its own tokenizer; cl100k_base typically underestimates by ~10%.',
    },
    'claude-haiku':     {
        encoding: 'cl100k_base', accuracy: 'approximate',
        note: 'Claude uses its own tokenizer; cl100k_base typically underestimates by ~10%.',
    },
};

const FALLBACK_SPEC: TokenizerSpec = {
    encoding: 'cl100k_base',
    accuracy: 'approximate',
    note: 'Unknown model — falling back to cl100k_base.',
};

const encoderCache = new Map<EncodingName, Tiktoken>();
function getEncoder(name: EncodingName): Tiktoken {
    let enc = encoderCache.get(name);
    if (!enc) {
        enc = get_encoding(name);
        encoderCache.set(name, enc);
    }
    return enc;
}

// Global default. Updated by the extension when defaultModel setting changes,
// so callers that don't pass a model still get the right tokenizer for the
// user's selected model.
let activeModel = 'gpt-4o';

export function setActiveModel(model: string): void {
    activeModel = model;
}

export function getActiveModel(): string {
    return activeModel;
}

export function getTokenizerInfo(model?: string): TokenizerSpec {
    return MODEL_TO_TOKENIZER[model ?? activeModel] ?? FALLBACK_SPEC;
}

export function countTokens(text: string, model?: string): number {
    if (!text || text.trim() === '') {
        return 0;
    }
    const spec = getTokenizerInfo(model);
    return getEncoder(spec.encoding).encode(text).length;
}

export function estimateCost(tokenCount: number, model: string): string {
    const pricing: { [key: string]: number } = {
        'gpt-4o':           0.000005,
        'gpt-4o-mini':      0.0000006,
        'claude-sonnet':    0.000003,
        'claude-haiku':     0.0000008,
    };

    const pricePerToken = pricing[model] || pricing['gpt-4o'];
    const cost = tokenCount * pricePerToken;

    if (cost < 0.001) {
        return `$${(cost * 100).toFixed(4)}¢`;
    }
    return `$${cost.toFixed(4)}`;
}

import { get_encoding } from 'tiktoken';

// We use cl100k_base encoding — this is what GPT-4 and Claude use
const encoder = get_encoding('cl100k_base');

export function countTokens(text: string): number {
    if (!text || text.trim() === '') {
        return 0;
    }
    const tokens = encoder.encode(text);
    return tokens.length;
}

export function estimateCost(tokenCount: number, model: string): string {
    // Cost per token for each model (input pricing)
    const pricing: { [key: string]: number } = {
        'gpt-4o':           0.000005,
        'gpt-4o-mini':      0.0000006,
        'claude-sonnet':    0.000003,
        'claude-haiku':     0.0000008,
    };

    const pricePerToken = pricing[model] || pricing['gpt-4o'];
    const cost = tokenCount * pricePerToken;

    // Format nicely
    if (cost < 0.001) {
        return `$${(cost * 100).toFixed(4)}¢`;
    }
    return `$${cost.toFixed(4)}`;
}
// Lazy-loaded wrapper around @xenova/transformers. Everything that touches the
// heavy ONNX runtime lives behind dynamic import() so users with the feature
// disabled pay zero startup cost.
//
// Single global pipeline shared across all callers — model load happens once
// on first embed() call.

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';   // 384-dim, ~25MB on disk

type EmbeddingPipeline = (
    texts: string | string[],
    opts?: { pooling?: 'none' | 'mean' | 'cls'; normalize?: boolean },
) => Promise<{ data: Float32Array | number[]; dims?: number[] }>;

let pipelinePromise: Promise<EmbeddingPipeline> | null = null;
let loadedModelId: string | null = null;

export interface SemanticEngineOptions {
    modelId?: string;
    /** Optional callback called once when the model is downloaded/loaded for the first time. */
    onModelLoaded?: (modelId: string) => void;
}

export class SemanticEngine {
    /** Async load of the embedding pipeline. Memoised — safe to call repeatedly. */
    static async ready(options: SemanticEngineOptions = {}): Promise<void> {
        const modelId = options.modelId ?? DEFAULT_MODEL;
        if (pipelinePromise && loadedModelId === modelId) return;
        loadedModelId = modelId;
        pipelinePromise = (async () => {
            // Dynamic import — keeps transformers out of the cold-start path
            const transformers = await import('@xenova/transformers');
            const { pipeline, env } = transformers as {
                pipeline: (task: string, model: string) => Promise<EmbeddingPipeline>;
                env: { allowRemoteModels?: boolean; localModelPath?: string; cacheDir?: string };
            };
            // Cache models in a stable location so we don't re-download on reload
            env.allowRemoteModels = true;
            return pipeline('feature-extraction', modelId);
        })();
        await pipelinePromise;
        options.onModelLoaded?.(modelId);
    }

    /** Embed one text, returning a unit-length 384-dim vector. */
    static async embed(text: string, options: SemanticEngineOptions = {}): Promise<number[]> {
        await SemanticEngine.ready(options);
        const pipe = await pipelinePromise!;
        const out = await pipe(text, { pooling: 'mean', normalize: true });
        return Array.from(out.data as Float32Array | number[]);
    }

    /** Embed many texts. Returns array of vectors in the same order. */
    static async embedBatch(texts: string[], options: SemanticEngineOptions = {}): Promise<number[][]> {
        await SemanticEngine.ready(options);
        const pipe = await pipelinePromise!;
        const out: number[][] = [];
        // Process one at a time for now — batching needs careful dim handling
        for (const t of texts) {
            const r = await pipe(t, { pooling: 'mean', normalize: true });
            out.push(Array.from(r.data as Float32Array | number[]));
        }
        return out;
    }

    static isLoaded(): boolean {
        return pipelinePromise !== null;
    }

    static getModelId(): string {
        return loadedModelId ?? DEFAULT_MODEL;
    }

    /** For tests / reset scenarios. */
    static reset(): void {
        pipelinePromise = null;
        loadedModelId = null;
    }
}

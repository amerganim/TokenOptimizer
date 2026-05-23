import { CodeIndexer } from './codeIndexer';
import { SemanticEngine } from './semanticEngine';
import { SearchHit, topNBySimilarity } from './semanticHelpers';

export interface SemanticSearchOptions {
    /** Max number of hits to return. */
    topN: number;
    /** Drop hits below this cosine similarity. */
    minScore?: number;
    /** Optional file path filter — only return chunks whose relPath matches. */
    pathFilter?: (relPath: string) => boolean;
}

export class SemanticSearch {
    /**
     * Embed the query, score against the persisted index, return top N hits.
     * Returns empty array if the index hasn't been built yet.
     */
    static async search(query: string, opts: SemanticSearchOptions): Promise<SearchHit[]> {
        const index = await CodeIndexer.getIndex();
        if (!index || index.chunks.length === 0) return [];

        const queryEmbedding = await SemanticEngine.embed(query);

        const candidates = opts.pathFilter
            ? index.chunks.filter(c => opts.pathFilter!(c.relPath))
            : index.chunks;

        return topNBySimilarity(
            queryEmbedding,
            candidates,
            opts.topN,
            opts.minScore ?? 0,
        );
    }
}

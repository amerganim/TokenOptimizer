// Pure keyword extraction for prompt → workspace-search routing.
// NO `vscode` imports — must stay Jest-testable.

export interface KeywordResult {
    /** Distinct keywords ranked by significance (highest first). Lowercased. */
    keywords: string[];
    /** Map from keyword → composite score, exposed for debugging/UI. */
    scores: Record<string, number>;
    /** Token forms we accepted (before lowercasing/dedup), in document order. */
    rawTokens: string[];
}

// English + common dev-noise stopwords. Kept conservative — words that frequently
// appear in prompts but never identify a file/symbol.
const STOPWORDS = new Set<string>([
    // English structural
    'a','an','the','and','or','but','if','then','else','so','as','than','because',
    'while','with','without','from','to','into','for','of','in','on','at','by',
    'about','against','between','through','during','before','after','above',
    'below','up','down','out','off','over','under','again','further','once',
    'here','there','now','just','only','same','also','too','very','really',
    'quite','rather','such','some','any','few','many','much','most','other',
    'all','each','every',
    // Pronouns/aux verbs
    'i','me','my','mine','we','us','our','you','your','he','him','his','she',
    'her','it','its','they','them','their','this','that','these','those',
    'is','are','was','were','be','been','being','am',
    'do','does','did','have','has','had',
    'will','would','could','should','may','might','must','can','cannot',
    'shall','ought',
    // Question words
    'what','which','who','whom','when','where','why','how',
    // Common prompt verbs (low signal)
    'fix','add','remove','update','check','show','make','get','set','let','use',
    'see','try','help','please','thanks','thank','explain','review','tell',
    'find','look','take','want','need','build','run',
    // Generic dev nouns (low signal, too broad)
    'code','file','files','function','functions','method','methods','class',
    'classes','bug','bugs','issue','issues','problem','problems','error','errors',
    'thing','things','something','someone','anything','everything','stuff',
    'way','ways','line','lines','part','parts','test','tests','module','modules',
    'project','app','application','source','feature','features',
    // Filler
    'maybe','perhaps','possibly','probably','definitely','certainly',
    'always','never','often','sometimes','usually','generally','typically',
    'good','bad','better','worse','best','worst','new','old','simple','easy','hard',
    'one','two','three','four','five','six','seven','eight','nine','ten',
]);

/**
 * Extract candidate keywords from a prompt.
 *
 * Strategy:
 *  - Strip fenced code blocks and inline code (their identifiers are the user's
 *    actual code, not a query — don't pollute the search).
 *  - Tokenize on identifier-like patterns (letters, digits, _, $).
 *  - Score by signal strength: CamelCase / snake_case / PascalCase / leading-cap.
 *  - Drop stopwords and tokens shorter than 3 chars.
 *  - Sum scores per lowercased keyword; return sorted desc.
 */
export function extractKeywords(text: string): KeywordResult {
    if (!text) return { keywords: [], scores: {}, rawTokens: [] };

    // Strip code so we don't index identifiers verbatim from snippets
    const stripped = text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`\n]+`/g, ' ');

    const tokenPattern = /[a-zA-Z_][\w$]*/g;
    const rawTokens: string[] = [];
    const scores = new Map<string, number>();

    let m: RegExpExecArray | null;
    while ((m = tokenPattern.exec(stripped)) !== null) {
        const tok = m[0];
        if (tok.length < 3) continue;
        rawTokens.push(tok);
        const lower = tok.toLowerCase();
        if (STOPWORDS.has(lower)) continue;

        let score = 1;
        // camelCase / PascalCase signal: capital after first char
        const hasInteriorCap = /[A-Z]/.test(tok.slice(1));
        if (hasInteriorCap) score += 2;
        // snake_case: high-signal identifier
        if (tok.includes('_')) score += 2;
        // Starts with uppercase: likely a Class / Type
        if (/^[A-Z]/.test(tok)) score += 1;
        // Pure lowercase short word: weakest signal
        if (!hasInteriorCap && !tok.includes('_') && tok.length <= 4) score = Math.max(1, score - 1);

        scores.set(lower, (scores.get(lower) ?? 0) + score);
    }

    const keywords = [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k);

    const scoresObj: Record<string, number> = {};
    for (const [k, v] of scores) scoresObj[k] = v;

    return { keywords, scores: scoresObj, rawTokens };
}

/** Convenience: top N keywords as a flat list. */
export function topKeywords(text: string, n: number): string[] {
    return extractKeywords(text).keywords.slice(0, n);
}

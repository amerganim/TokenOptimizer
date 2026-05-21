import { countTokens } from './tokenCounter';

export interface CompressOptions {
    removePoliteness: boolean;
    removeHedging: boolean;
    removeMetaCommentary: boolean;
    shortenPhrases: boolean;
    removeFillerAdverbs: boolean;
    abbreviateTechnical: boolean;
    normalizePunctuation: boolean;
    collapseWhitespace: boolean;
    preserveCodeBlocks: boolean;
}

export interface CompressResult {
    original: string;
    compressed: string;
    originalTokens: number;
    compressedTokens: number;
    tokensSaved: number;
    percentSaved: number;
    rulesApplied: string[];
}

export const COMPRESS_LIGHT: CompressOptions = {
    removePoliteness: false,
    removeHedging: false,
    removeMetaCommentary: false,
    shortenPhrases: false,
    removeFillerAdverbs: false,
    abbreviateTechnical: false,
    normalizePunctuation: true,
    collapseWhitespace: true,
    preserveCodeBlocks: true,
};

export const COMPRESS_DEFAULT: CompressOptions = {
    removePoliteness: true,
    removeHedging: true,
    removeMetaCommentary: true,
    shortenPhrases: true,
    removeFillerAdverbs: false,
    abbreviateTechnical: false,
    normalizePunctuation: true,
    collapseWhitespace: true,
    preserveCodeBlocks: true,
};

export const COMPRESS_AGGRESSIVE: CompressOptions = {
    removePoliteness: true,
    removeHedging: true,
    removeMetaCommentary: true,
    shortenPhrases: true,
    removeFillerAdverbs: true,
    abbreviateTechnical: true,
    normalizePunctuation: true,
    collapseWhitespace: true,
    preserveCodeBlocks: true,
};

// "Could you please ...", "I was wondering if you can ...", "Thanks in advance"
const POLITENESS_RULES: Array<[RegExp, string]> = [
    [/\bcould you (please )?/gi, ''],
    [/\bwould you (please )?(kindly )?/gi, ''],
    [/\bcan you (please )?(kindly )?/gi, ''],
    [/\bplease (could|would|can) you /gi, ''],
    [/\bplease\b,?\s*/gi, ''],
    [/\bkindly\b,?\s*/gi, ''],
    [/\bif you don'?t mind\b,?\s*/gi, ''],
    [/\bif (it'?s )?possible\b,?\s*/gi, ''],
    [/\b(many )?thanks (in advance|so much|very much|a lot)\b\.?/gi, ''],
    [/\bthank you (in advance|so much|very much|kindly)\b\.?/gi, ''],
    [/\bthanks!?\s*$/gim, ''],
    [/\bthank you!?\s*$/gim, ''],
    [/\bi'?d (really )?appreciate (it )?if you (could|would|can) /gi, ''],
    [/\bi was (just )?(wondering|hoping) (if|whether) (you (could|would|can) )?/gi, ''],
    [/\bi'?m (just )?(wondering|hoping) (if|whether) (you (could|would|can) )?/gi, ''],
    [/\bdo you (think you could|mind|think you can) /gi, ''],
];

// "I think", "I believe", "maybe", "in my opinion"
const HEDGING_RULES: Array<[RegExp, string]> = [
    [/\bi (think|believe|guess|suppose|reckon) (that )?/gi, ''],
    [/\bin my (opinion|view|experience)\b,?\s*/gi, ''],
    [/\bfrom my (perspective|point of view)\b,?\s*/gi, ''],
    [/\bit (seems|appears) (to me )?(that |like )?/gi, ''],
    [/\bif i'?m not mistaken\b,?\s*/gi, ''],
    [/\bcorrect me if i'?m wrong,?\s*(but )?/gi, ''],
];

// "as I mentioned", "to be clear", "it should be noted that"
const META_COMMENTARY_RULES: Array<[RegExp, string]> = [
    [/\bas (i )?(mentioned|said|stated|noted) (before|earlier|previously|above)\b,?\s*/gi, ''],
    [/\bas (previously|earlier) (mentioned|stated|noted)\b,?\s*/gi, ''],
    [/\bto be clear\b,?\s*/gi, ''],
    [/\bjust to (clarify|be clear|confirm)\b,?\s*/gi, ''],
    [/\bfor (your )?(clarity|reference|context)\b,?\s*/gi, ''],
    [/\bit (is|should be) (important to note|worth (noting|mentioning)) (that )?/gi, ''],
    [/\bit (is|should be) noted that\b,?\s*/gi, ''],
    [/\bplease (note|be aware|keep in mind) (that )?/gi, ''],
    [/\bfor what it'?s worth,?\s*/gi, ''],
    [/\bat the end of the day,?\s*/gi, ''],
    [/\bto make a long story short,?\s*/gi, ''],
    [/\blong story short,?\s*/gi, ''],
];

// Verbose phrase → concise equivalent
const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
    [/\bin order to\b/gi, 'to'],
    [/\bso as to\b/gi, 'to'],
    [/\bfor the purpose of\b/gi, 'to'],
    [/\bwith the intention of\b/gi, 'to'],
    [/\bat (this|the present) (point in time|moment)\b/gi, 'now'],
    [/\bat the present time\b/gi, 'now'],
    [/\bdue to the fact that\b/gi, 'because'],
    [/\bowing to the fact that\b/gi, 'because'],
    [/\bin (the event|case) that\b/gi, 'if'],
    [/\bin the case where\b/gi, 'if'],
    [/\bon the off chance that\b/gi, 'if'],
    [/\bthe reason (why )?is (that )?/gi, 'because '],
    [/\bwith regards? to\b/gi, 'about'],
    [/\bin reference to\b/gi, 'about'],
    [/\bwith respect to\b/gi, 'about'],
    [/\bin (the )?(case|context) of\b/gi, 'for'],
    [/\ba (large|great) number of\b/gi, 'many'],
    [/\ba (small|tiny) number of\b/gi, 'few'],
    [/\bin spite of (the fact that )?/gi, 'despite '],
    [/\bdespite the fact that\b/gi, 'although'],
    [/\bregardless of (the fact that )?/gi, 'regardless '],
    [/\bon the basis of\b/gi, 'from'],
    [/\b(is|are|will be) able to\b/gi, 'can'],
    [/\bhas the ability to\b/gi, 'can'],
    [/\bhave the ability to\b/gi, 'can'],
    [/\bin a (manner|way) that\b/gi, 'so'],
    [/\bmake (a |the )?decision\b/gi, 'decide'],
    [/\bgive consideration to\b/gi, 'consider'],
    [/\btake into consideration\b/gi, 'consider'],
    [/\bcome to (the )?conclusion (that )?/gi, 'conclude '],
    [/\bin the process of\b/gi, 'while'],
    [/\bprior to\b/gi, 'before'],
    [/\bsubsequent to\b/gi, 'after'],
    [/\bin the near future\b/gi, 'soon'],
    [/\bat your earliest convenience\b/gi, 'soon'],
    [/\bin the (very )?(near|distant) future\b/gi, 'soon'],
    [/\ba majority of\b/gi, 'most'],
    [/\bthe majority of\b/gi, 'most'],
    [/\ba sufficient (amount|number) of\b/gi, 'enough'],
    [/\bin close proximity to\b/gi, 'near'],
    [/\bin order for\b/gi, 'for'],
    [/\bwhether or not\b/gi, 'whether'],
    [/\beach and every\b/gi, 'each'],
    [/\bany and all\b/gi, 'all'],
    [/\bfew and far between\b/gi, 'rare'],
    [/\bfirst and foremost\b/gi, 'first'],
    [/\bnull and void\b/gi, 'void'],
    [/\bend result\b/gi, 'result'],
    [/\bfinal outcome\b/gi, 'outcome'],
    [/\bpast history\b/gi, 'history'],
    [/\bfuture plans\b/gi, 'plans'],
    [/\bactual fact\b/gi, 'fact'],
    [/\btrue fact\b/gi, 'fact'],
    [/\bcompletely (eliminate|destroy|finish)\b/gi, '$1'],
    [/\btotally (eliminate|destroy|finish)\b/gi, '$1'],
];

// "actually", "basically", "literally", "essentially" — opinionated; aggressive only
const FILLER_ADVERBS: Array<[RegExp, string]> = [
    [/\bactually\b,?\s*/gi, ''],
    [/\bbasically\b,?\s*/gi, ''],
    [/\bliterally\b,?\s*/gi, ''],
    [/\bessentially\b,?\s*/gi, ''],
    [/\bpretty much\b,?\s*/gi, ''],
    [/\bsort of\b,?\s*/gi, ''],
    [/\bkind of\b,?\s*/gi, ''],
    [/\bin a way\b,?\s*/gi, ''],
    [/\bvery (much )?/gi, ''],
    [/\breally\b,?\s*/gi, ''],
    [/\bquite\b,?\s*/gi, ''],
    [/\brather\b,?\s*/gi, ''],
    [/\bsomewhat\b,?\s*/gi, ''],
    [/\bsimply\b,?\s*/gi, ''],
    [/\bjust\b,?\s*/gi, ''],
];

// Technical abbreviations — aggressive only (may lose precision)
const TECHNICAL_ABBREVIATIONS: Array<[RegExp, string]> = [
    [/\bauthentication\b/gi, 'auth'],
    [/\bauthorization\b/gi, 'authz'],
    [/\bapplication\b/gi, 'app'],
    [/\bapplications\b/gi, 'apps'],
    [/\bconfiguration\b/gi, 'config'],
    [/\bconfigurations\b/gi, 'configs'],
    [/\bdocumentation\b/gi, 'docs'],
    [/\bdatabase\b/gi, 'db'],
    [/\bdatabases\b/gi, 'dbs'],
    [/\benvironment\b/gi, 'env'],
    [/\benvironments\b/gi, 'envs'],
    [/\benvironment variables?\b/gi, 'env vars'],
    [/\bparameters?\b/gi, 'params'],
    [/\brepository\b/gi, 'repo'],
    [/\brepositories\b/gi, 'repos'],
    [/\bdirector(y|ies)\b/gi, 'dir'],
    [/\binformation\b/gi, 'info'],
    [/\bdevelopment\b/gi, 'dev'],
    [/\bproduction\b/gi, 'prod'],
    [/\bdependenc(y|ies)\b/gi, 'dep'],
    [/\bperformance\b/gi, 'perf'],
    [/\binitialization\b/gi, 'init'],
    [/\binitialize\b/gi, 'init'],
    [/\bsynchronization\b/gi, 'sync'],
    [/\basynchronous\b/gi, 'async'],
    [/\bsynchronous\b/gi, 'sync'],
];

export class PromptCompressor {
    static compress(text: string, options: CompressOptions = COMPRESS_DEFAULT): CompressResult {
        const originalTokens = countTokens(text);
        const rulesApplied: string[] = [];

        let working = text;
        let codeBlocks: string[] = [];
        let inlineCode: string[] = [];

        // Stash code blocks so compression never touches them
        if (options.preserveCodeBlocks) {
            working = working.replace(/```[\s\S]*?```/g, m => {
                codeBlocks.push(m);
                return `\x00CB${codeBlocks.length - 1}\x00`;
            });
            working = working.replace(/`[^`\n]+`/g, m => {
                inlineCode.push(m);
                return `\x00IC${inlineCode.length - 1}\x00`;
            });
        }

        const applyRules = (
            rules: Array<[RegExp, string]>,
            label: string,
        ) => {
            const before = working;
            for (const [pattern, replacement] of rules) {
                working = working.replace(pattern, replacement);
            }
            if (working !== before) {
                rulesApplied.push(label);
            }
        };

        if (options.removePoliteness)     applyRules(POLITENESS_RULES,      'remove-politeness');
        if (options.removeHedging)        applyRules(HEDGING_RULES,         'remove-hedging');
        if (options.removeMetaCommentary) applyRules(META_COMMENTARY_RULES, 'remove-meta-commentary');
        if (options.shortenPhrases)       applyRules(PHRASE_REPLACEMENTS,   'shorten-phrases');
        if (options.removeFillerAdverbs)  applyRules(FILLER_ADVERBS,        'remove-filler-adverbs');
        if (options.abbreviateTechnical)  applyRules(TECHNICAL_ABBREVIATIONS, 'abbreviate-technical');

        if (options.normalizePunctuation) {
            const before = working;
            working = working
                .replace(/!{2,}/g, '!')
                .replace(/\?{2,}/g, '?')
                .replace(/\.{4,}/g, '...')
                .replace(/,{2,}/g, ',')
                .replace(/\s+([.,;:!?])/g, '$1');
            if (working !== before) rulesApplied.push('normalize-punctuation');
        }

        if (options.collapseWhitespace) {
            const before = working;
            working = working
                .replace(/[ \t]{2,}/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .split('\n').map(line => line.trimEnd()).join('\n')
                .trim();
            if (working !== before) rulesApplied.push('collapse-whitespace');
        }

        // Restore code
        if (options.preserveCodeBlocks) {
            working = working.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCode[parseInt(i, 10)]);
            working = working.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i, 10)]);
        }

        const compressedTokens = countTokens(working);
        const tokensSaved = originalTokens - compressedTokens;
        const percentSaved = originalTokens > 0
            ? Math.round((tokensSaved / originalTokens) * 100)
            : 0;

        return {
            original: text,
            compressed: working,
            originalTokens,
            compressedTokens,
            tokensSaved,
            percentSaved,
            rulesApplied,
        };
    }
}

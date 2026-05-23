import { extractKeywords, topKeywords } from '../keywordExtractor';

describe('extractKeywords — basic', () => {
    it('returns empty for empty input', () => {
        const r = extractKeywords('');
        expect(r.keywords).toEqual([]);
        expect(r.scores).toEqual({});
        expect(r.rawTokens).toEqual([]);
    });

    it('filters out stopwords', () => {
        const r = extractKeywords('please fix the bug in the code');
        expect(r.keywords).not.toContain('please');
        expect(r.keywords).not.toContain('fix');
        expect(r.keywords).not.toContain('the');
        expect(r.keywords).not.toContain('bug');
        expect(r.keywords).not.toContain('code');
    });

    it('drops tokens shorter than 3 chars', () => {
        const r = extractKeywords('fix my UI bug');
        expect(r.keywords).not.toContain('ui');
        expect(r.keywords).not.toContain('my');
    });
});

describe('extractKeywords — scoring', () => {
    it('PascalCase / CamelCase scores higher than lowercase', () => {
        const r = extractKeywords('Why is LoginHandler returning errors for sessions?');
        const idx = r.keywords.indexOf('loginhandler');
        const sessionIdx = r.keywords.indexOf('sessions');
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(sessionIdx).toBeGreaterThanOrEqual(0);
        // LoginHandler should rank higher (CamelCase + leading-cap)
        expect(r.scores['loginhandler']).toBeGreaterThan(r.scores['sessions']);
    });

    it('snake_case scores high', () => {
        const r = extractKeywords('Investigate the user_session_store behaviour');
        expect(r.keywords[0]).toBe('user_session_store');
        expect(r.scores['user_session_store']).toBeGreaterThanOrEqual(3);
    });

    it('repeated keywords accumulate score', () => {
        const r = extractKeywords('auth auth auth needs cleanup in modules');
        expect(r.keywords[0]).toBe('auth');
        expect(r.scores['auth']).toBeGreaterThanOrEqual(3);
    });
});

describe('extractKeywords — code stripping', () => {
    it('ignores identifiers inside fenced code blocks', () => {
        const input = [
            'Help me with the AuthMiddleware design.',
            '```ts',
            'const SECRET_TOKEN = "should_not_be_indexed";',
            'function shouldBeIgnored() {}',
            '```',
        ].join('\n');
        const r = extractKeywords(input);
        expect(r.keywords).toContain('authmiddleware');
        expect(r.keywords).not.toContain('secret_token');
        expect(r.keywords).not.toContain('shouldbeignored');
    });

    it('ignores identifiers inside inline code', () => {
        const r = extractKeywords('Fix the routing in `notIndexedSymbol` for the WebServer');
        expect(r.keywords).toContain('webserver');
        expect(r.keywords).not.toContain('notindexedsymbol');
    });
});

describe('extractKeywords — ranking', () => {
    it('orders keywords by score desc', () => {
        const r = extractKeywords(
            'LoginHandler.authenticate fails with session timeout in user_auth_module',
        );
        // user_auth_module (snake_case = score 3) + loginhandler (CamelCase + caps = 4)
        // should both appear, and the highest-scoring keyword leads
        const top2 = r.keywords.slice(0, 2);
        expect(top2).toContain('loginhandler');
        expect(top2).toContain('user_auth_module');
    });
});

describe('topKeywords convenience', () => {
    it('returns at most N keywords', () => {
        const r = topKeywords(
            'LoginHandler AuthMiddleware SessionStore UserProfile DatabaseAdapter RouteResolver',
            3,
        );
        expect(r.length).toBe(3);
    });

    it('returns fewer if not enough non-stopword tokens', () => {
        const r = topKeywords('please fix the bug', 5);
        expect(r.length).toBe(0);
    });
});

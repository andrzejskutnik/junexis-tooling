const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const platformRoot = path.resolve(__dirname, '..', '..', '..');
const grammarPath = path.join(platformRoot, 'junexis-lang', 'grammar', 'JunexisLang.g4');
const textMatePath = path.join(__dirname, '..', 'syntaxes', 'junexis.tmLanguage.json');
const studioPath = path.join(
    platformRoot,
    'junexis-studio',
    'src',
    'Shell',
    'Highlighting',
    'JunexisLang.xshd',
);
const sharedSourcesAvailable = fs.existsSync(grammarPath) && fs.existsSync(studioPath);

function canonicalWords(grammar) {
    const keywordStart = grammar.indexOf('// Keywords — Declarations');
    const literalStart = grammar.indexOf('// Literals', keywordStart);
    const lexer = grammar.slice(keywordStart, literalStart);
    const result = new Set();
    const rulePattern = /^[A-Z][A-Z0-9_]*\s*:\s*([^;]+);/gm;
    for (const rule of lexer.matchAll(rulePattern)) {
        for (const literal of rule[1].matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) {
            result.add(literal[1]);
        }
    }
    return [...result].sort();
}

function textMatePatterns(value, result = []) {
    if (Array.isArray(value)) {
        for (const item of value) {
            textMatePatterns(item, result);
        }
    } else if (value && typeof value === 'object') {
        if (typeof value.match === 'string') {
            result.push(new RegExp(value.match));
        }
        for (const child of Object.values(value)) {
            textMatePatterns(child, result);
        }
    }
    return result;
}

function coveredByTextMate(word, patterns) {
    const samples = [word, `@${word}`, `${word} Example`, `${word}<Text>`];
    return patterns.some(pattern => samples.some(sample => {
        pattern.lastIndex = 0;
        return pattern.test(sample);
    }));
}

function studioWords(xshd) {
    const result = new Set(
        [...xshd.matchAll(/<Word>([^<]+)<\/Word>/g)].map(match => match[1]),
    );
    const platformGroup = xshd.match(/@\(([^)]+)\)\\b/);
    for (const word of platformGroup?.[1].split('|') ?? []) {
        result.add(word);
    }
    return result;
}

test('canonical ANTLR keywords are highlighted by VS Code and Studio', {
    skip: sharedSourcesAvailable ? false : 'Canonical grammar and Studio source are not checked out.',
}, () => {
    const grammar = fs.readFileSync(grammarPath, 'utf8');
    const textMate = JSON.parse(fs.readFileSync(textMatePath, 'utf8'));
    const studio = fs.readFileSync(studioPath, 'utf8');
    const words = canonicalWords(grammar);
    const vsPatterns = textMatePatterns(textMate);
    const studioVocabulary = studioWords(studio);

    const missingInVsCode = words.filter(word => !coveredByTextMate(word, vsPatterns));
    const missingInStudio = words.filter(word => !studioVocabulary.has(word));

    assert.deepEqual(missingInVsCode, [], `VS Code misses: ${missingInVsCode.join(', ')}`);
    assert.deepEqual(missingInStudio, [], `Studio misses: ${missingInStudio.join(', ')}`);
});

test('VS Code grammar uses the canonical raw and triple string forms', () => {
    const textMate = JSON.parse(fs.readFileSync(textMatePath, 'utf8'));

    assert.equal(textMate.repository['raw-strings'].begin, '@"');
    assert.equal(textMate.repository['triple-strings'].begin, '"""');
});

test('Studio grammar uses the canonical raw and triple string forms', {
    skip: fs.existsSync(studioPath) ? false : 'Canonical Studio source is not checked out.',
}, () => {
    const studio = fs.readFileSync(studioPath, 'utf8');

    assert.match(studio, /<Begin>@"<\/Begin>/);
    assert.doesNotMatch(studio, /<Begin>r["']/);
    assert.doesNotMatch(studio, /<Begin>'''<\/Begin>/);
});

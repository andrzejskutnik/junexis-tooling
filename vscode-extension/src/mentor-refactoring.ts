import * as path from 'path';
import type { MentorFinding } from './mentor-contract';

export interface AnalysisSource {
    file: string;
    line: number;
    column: number;
}

export interface AnalysisSymbol {
    id: string;
    kind: string;
    name: string;
    source?: AnalysisSource | null;
}

export interface AnalysisSnapshot {
    buildId: string;
    symbols: AnalysisSymbol[];
}

export interface MentorRefactoringProposal {
    id: string;
    findingCode: string;
    title: string;
    filePath: string;
    relatedSymbolId: string;
    originalContent: string;
    updatedContent: string;
    patch: string;
    assumptions: string[];
    expectedEffect: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAnalysisSnapshot(json: string): AnalysisSnapshot {
    const value: unknown = JSON.parse(json);
    if (!isRecord(value) || typeof value.buildId !== 'string' || !Array.isArray(value.symbols)) {
        throw new Error('Analysis snapshot is missing buildId or symbols.');
    }
    for (const symbol of value.symbols) {
        if (!isRecord(symbol)
            || typeof symbol.id !== 'string'
            || typeof symbol.kind !== 'string'
            || typeof symbol.name !== 'string') {
            throw new Error('Analysis snapshot contains an invalid symbol.');
        }
    }
    return value as unknown as AnalysisSnapshot;
}

/** Mirrors Studio's deterministic, deliberately narrow M1002 proposal. */
export function createM1002Proposal(
    snapshot: AnalysisSnapshot,
    finding: MentorFinding,
    projectRoot: string,
    originalContent: string,
): MentorRefactoringProposal {
    if (finding.code !== 'M1002') {
        throw new Error(`Mentor rule '${finding.code}' has no safe refactoring.`);
    }
    if (!finding.relatedSymbolId) {
        throw new Error('M1002 finding does not identify a stable pipeline symbol.');
    }
    const pipeline = snapshot.symbols.find(symbol =>
        symbol.id === finding.relatedSymbolId
        && symbol.kind.toLowerCase() === 'pipeline');
    if (!pipeline?.source?.file) {
        throw new Error('The affected pipeline has no exact compiler source location.');
    }

    const root = path.resolve(projectRoot);
    const filePath = path.resolve(root, pipeline.source.file);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        throw new Error('Mentor refactoring cannot write outside the open project.');
    }

    const newline = originalContent.includes('\r\n') ? '\r\n' : '\n';
    const escapedName = pipeline.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const block = [
        `narrative "${escapedName} intent" {`,
        `    intent "TODO: describe the system intent served by ${escapedName}"`,
        `    applies_to { ${pipeline.name} }`,
        '}',
    ].join(newline);
    const separator = originalContent.length === 0
        ? ''
        : originalContent.endsWith('\n')
            ? newline
            : newline + newline;
    const added = separator + block + newline;
    const updatedContent = originalContent + added;
    const addedLines = added.replace(/\r\n/g, '\n').split('\n').slice(0, -1);
    const oldLineCount = originalContent.length === 0
        ? 0
        : (originalContent.match(/\n/g)?.length ?? 0) + (originalContent.endsWith('\n') ? 0 : 1);
    const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
    const patch = [
        `--- a/${relativePath}`,
        `+++ b/${relativePath}`,
        `@@ -${oldLineCount},0 +${oldLineCount + 1},${addedLines.length} @@`,
        ...addedLines.map(line => `+${line}`),
    ].join('\n');

    return {
        id: `mentor:M1002:${pipeline.id}`,
        findingCode: finding.code,
        title: `Add Narrative boundary for pipeline ${pipeline.name}`,
        filePath,
        relatedSymbolId: pipeline.id,
        originalContent,
        updatedContent,
        patch,
        assumptions: [
            'The generated intent is an explicit TODO and must be completed by the system author.',
            'The proposal only binds the selected pipeline; it does not invent stakeholders, compliance, or degraded semantics.',
        ],
        expectedEffect: `The pipeline '${pipeline.name}' becomes explicitly covered by Narrative applies_to.`,
    };
}

/** Connects one disconnected Narrative only when the compiler sees one unambiguous pipeline. */
export function createM1012Proposal(
    snapshot: AnalysisSnapshot,
    finding: MentorFinding,
    projectRoot: string,
    originalContent: string,
): MentorRefactoringProposal {
    if (finding.code !== 'M1012') {
        throw new Error(`Mentor rule '${finding.code}' has no safe refactoring.`);
    }
    if (!finding.relatedSymbolId) {
        throw new Error('M1012 finding does not identify a stable Narrative symbol.');
    }
    const narrative = snapshot.symbols.find(symbol =>
        symbol.id === finding.relatedSymbolId
        && symbol.kind.toLowerCase() === 'narrative');
    if (!narrative?.source?.file) {
        throw new Error('The affected Narrative has no exact compiler source location.');
    }
    const pipelines = snapshot.symbols.filter(symbol =>
        symbol.kind.toLowerCase() === 'pipeline');
    if (pipelines.length !== 1) {
        throw new Error(
            `M1012 can be refactored only when the current build contains exactly one pipeline; found ${pipelines.length}.`);
    }

    const root = path.resolve(projectRoot);
    const filePath = path.resolve(root, narrative.source.file);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        throw new Error('Mentor refactoring cannot write outside the open project.');
    }

    const newline = originalContent.includes('\r\n') ? '\r\n' : '\n';
    const declarationOffset = offsetAtLine(originalContent, narrative.source.line);
    const declarationLineEnd = originalContent.indexOf('\n', declarationOffset);
    const headerEnd = declarationLineEnd < 0 ? originalContent.length : declarationLineEnd;
    const header = originalContent.slice(declarationOffset, headerEnd);
    const openingBrace = originalContent.indexOf('{', declarationOffset);
    const declaredName = openingBrace >= declarationOffset && openingBrace < headerEnd
        ? header.slice(header.indexOf('narrative') + 'narrative'.length, header.indexOf('{')).trim()
        : '';
    const quotedName = `"${narrative.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const identifierName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(narrative.name)
        ? narrative.name
        : undefined;
    if (!/^\s*narrative\b/.test(header)
        || (declaredName !== quotedName && declaredName !== identifierName)) {
        throw new Error('The compiler Narrative source location no longer matches the document.');
    }
    if (openingBrace < declarationOffset || openingBrace >= headerEnd) {
        throw new Error('The Narrative declaration has no opening brace.');
    }
    const closingBrace = findMatchingBrace(originalContent, openingBrace);
    const block = originalContent.slice(openingBrace, closingBrace + 1);
    if (/\bapplies_to\b/.test(block)) {
        throw new Error('The Narrative already contains applies_to; refresh Mentor analysis.');
    }
    const closingLineStart = originalContent.lastIndexOf('\n', closingBrace - 1) + 1;
    const closingIndent = originalContent.slice(closingLineStart, closingBrace);
    if (!/^[ \t]*$/.test(closingIndent)) {
        throw new Error('The Narrative closing brace must be on its own line for this safe refactoring.');
    }

    const pipeline = pipelines[0];
    const addedLine = `${closingIndent}    applies_to { ${pipeline.name} }`;
    const added = addedLine + newline;
    const updatedContent = originalContent.slice(0, closingLineStart)
        + added
        + originalContent.slice(closingLineStart);
    const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
    const oldLineCount = countLines(originalContent.slice(0, closingLineStart));
    const patch = [
        `--- a/${relativePath}`,
        `+++ b/${relativePath}`,
        `@@ -${oldLineCount},0 +${oldLineCount + 1},1 @@`,
        `+${addedLine}`,
    ].join('\n');

    return {
        id: `mentor:M1012:${narrative.id}`,
        findingCode: finding.code,
        title: `Connect Narrative '${narrative.name}' to pipeline ${pipeline.name}`,
        filePath,
        relatedSymbolId: narrative.id,
        originalContent,
        updatedContent,
        patch,
        assumptions: [
            `The current compiler snapshot contains exactly one pipeline: '${pipeline.name}'.`,
            'The system author must confirm that this existing Narrative describes that pipeline; no intent, stakeholder, compliance, or degraded semantics are generated.',
        ],
        expectedEffect:
            `The existing Narrative '${narrative.name}' becomes explicitly connected to pipeline '${pipeline.name}' through applies_to.`,
    };
}

function offsetAtLine(content: string, oneBasedLine: number): number {
    if (!Number.isInteger(oneBasedLine) || oneBasedLine < 1) {
        throw new Error('The compiler source line is invalid.');
    }
    let offset = 0;
    for (let line = 1; line < oneBasedLine; line += 1) {
        const next = content.indexOf('\n', offset);
        if (next < 0) {
            throw new Error('The compiler source line is outside the current document.');
        }
        offset = next + 1;
    }
    return offset;
}

function findMatchingBrace(content: string, openingBrace: number): number {
    let depth = 0;
    let quote = '';
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = openingBrace; index < content.length; index += 1) {
        const current = content[index];
        const next = content[index + 1] ?? '';
        if (lineComment) {
            if (current === '\n') {
                lineComment = false;
            }
            continue;
        }
        if (blockComment) {
            if (current === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === quote) {
                quote = '';
            }
            continue;
        }
        if (current === '/' && next === '/') {
            lineComment = true;
            index += 1;
        } else if (current === '/' && next === '*') {
            blockComment = true;
            index += 1;
        } else if (current === '"' || current === '\'') {
            quote = current;
        } else if (current === '{') {
            depth += 1;
        } else if (current === '}') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    throw new Error('The Narrative declaration has no matching closing brace.');
}

function countLines(content: string): number {
    if (content.length === 0) {
        return 0;
    }
    return (content.match(/\n/g)?.length ?? 0) + (content.endsWith('\n') ? 0 : 1);
}

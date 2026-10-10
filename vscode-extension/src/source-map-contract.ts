import * as path from 'path';

export interface JunexisSourcePosition {
    file: string;
    line: number;
    column: number;
}

export interface JunexisGeneratedRange {
    target: string;
    file: string;
    fullPath: string;
    startLine: number;
    endLine: number;
    startColumn: number;
}

export interface JunexisSourceMapping {
    symbolId: string;
    kind: string;
    irPath?: string;
    source: JunexisSourcePosition;
    generated: JunexisGeneratedRange;
}

export interface JunexisDebugSourceMap {
    schemaVersion: string;
    kind: 'junexis.debug-source-map';
    sourceFile: string;
    mappings: JunexisSourceMapping[];
}

export interface JunexisBreakpointRequest {
    line: number;
    enabled?: boolean;
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
}

export interface JunexisMappedBreakpoint extends JunexisBreakpointRequest {
    file: string;
    column: number;
    symbolId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Parses compiler source-map schema 1.0 and confines generated paths to the build output root. */
export function parseDebugSourceMap(json: string, outputRoot: string): JunexisDebugSourceMap {
    const value: unknown = JSON.parse(json);
    if (!isRecord(value) ||
        value.schemaVersion !== '1.0' ||
        value.kind !== 'junexis.debug-source-map' ||
        typeof value.sourceFile !== 'string' ||
        !Array.isArray(value.mappings)) {
        throw new Error('Unsupported or incomplete Junexis debug source-map contract.');
    }

    const fullOutputRoot = path.resolve(outputRoot);
    const mappings = value.mappings.map((candidate, index): JunexisSourceMapping => {
        if (!isRecord(candidate) ||
            typeof candidate.symbolId !== 'string' ||
            typeof candidate.kind !== 'string' ||
            !isRecord(candidate.source) ||
            typeof candidate.source.file !== 'string' ||
            !positiveInteger(candidate.source.line) ||
            !positiveInteger(candidate.source.column) ||
            !isRecord(candidate.generated) ||
            typeof candidate.generated.target !== 'string' ||
            typeof candidate.generated.file !== 'string' ||
            !positiveInteger(candidate.generated.startLine) ||
            !positiveInteger(candidate.generated.endLine) ||
            !positiveInteger(candidate.generated.startColumn) ||
            candidate.generated.endLine < candidate.generated.startLine) {
            throw new Error(`Debug source mapping #${index + 1} is incomplete.`);
        }
        if (path.isAbsolute(candidate.generated.file)) {
            throw new Error(`Unsafe generated source path '${candidate.generated.file}'.`);
        }
        const fullPath = path.resolve(
            fullOutputRoot,
            candidate.generated.file.split('/').join(path.sep));
        const relative = path.relative(fullOutputRoot, fullPath);
        if (!relative || relative === '..' ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)) {
            throw new Error(`Generated source path escapes output root: '${candidate.generated.file}'.`);
        }
        return {
            symbolId: candidate.symbolId,
            kind: candidate.kind,
            irPath: typeof candidate.irPath === 'string' ? candidate.irPath : undefined,
            source: {
                file: path.resolve(candidate.source.file),
                line: candidate.source.line,
                column: candidate.source.column,
            },
            generated: {
                target: candidate.generated.target,
                file: candidate.generated.file,
                fullPath,
                startLine: candidate.generated.startLine,
                endLine: candidate.generated.endLine,
                startColumn: candidate.generated.startColumn,
            },
        };
    });

    return {
        schemaVersion: '1.0',
        kind: 'junexis.debug-source-map',
        sourceFile: path.resolve(value.sourceFile),
        mappings,
    };
}

/** Mirrors Studio's exact-statement, preceding-statement, then task fallback policy. */
export function mapJunexisBreakpoints(
    sourceMap: JunexisDebugSourceMap,
    target: string,
    sourcePath: string,
    breakpoints: JunexisBreakpointRequest[],
): JunexisMappedBreakpoint[] {
    const normalizedSource = path.resolve(sourcePath);
    const candidates = sourceMap.mappings
        .filter(mapping =>
            mapping.generated.target.toLowerCase() === target.toLowerCase() &&
            mapping.source.file.toLowerCase() === normalizedSource.toLowerCase())
        .sort((left, right) => left.source.line - right.source.line);
    if (candidates.length === 0) {
        return [];
    }

    const mapped = breakpoints.flatMap(breakpoint => {
        const exactStatements = candidates.filter(mapping =>
            mapping.kind === 'statement' && mapping.source.line === breakpoint.line);
        let selected = exactStatements;
        if (selected.length === 0) {
            const precedingLine = candidates
                .filter(mapping => mapping.kind === 'statement' && mapping.source.line <= breakpoint.line)
                .reduce<number | undefined>(
                    (latest, mapping) => latest === undefined
                        ? mapping.source.line
                        : Math.max(latest, mapping.source.line),
                    undefined);
            if (precedingLine !== undefined) {
                selected = candidates.filter(mapping =>
                    mapping.kind === 'statement' && mapping.source.line === precedingLine);
            } else {
                selected = [
                    [...candidates].reverse().find(mapping => mapping.source.line <= breakpoint.line)
                    ?? candidates[0],
                ];
            }
        }
        return selected.map(mapping => ({
            file: mapping.generated.fullPath,
            line: mapping.generated.startLine,
            column: mapping.generated.startColumn,
            symbolId: mapping.symbolId,
            enabled: breakpoint.enabled,
            condition: breakpoint.condition,
            hitCondition: breakpoint.hitCondition,
            logMessage: breakpoint.logMessage,
        }));
    });
    const seen = new Set<string>();
    return mapped.filter(breakpoint => {
        const key = [
            breakpoint.file.toLowerCase(),
            breakpoint.line,
            breakpoint.column,
            breakpoint.enabled,
            breakpoint.condition,
            breakpoint.hitCondition,
            breakpoint.logMessage,
        ].join('\0');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/** Maps a generated runtime location back to the narrowest Junexis source span. */
export function mapGeneratedLocation(
    sourceMap: JunexisDebugSourceMap,
    generatedPath: string,
    line: number,
): JunexisSourceMapping | undefined {
    const normalizedPath = path.resolve(generatedPath);
    return sourceMap.mappings
        .filter(mapping =>
            mapping.generated.fullPath.toLowerCase() === normalizedPath.toLowerCase() &&
            line >= mapping.generated.startLine &&
            line <= mapping.generated.endLine)
        .sort((left, right) => {
            const leftWidth = left.generated.endLine - left.generated.startLine;
            const rightWidth = right.generated.endLine - right.generated.startLine;
            return leftWidth - rightWidth ||
                Number(right.kind === 'statement') - Number(left.kind === 'statement');
        })[0];
}

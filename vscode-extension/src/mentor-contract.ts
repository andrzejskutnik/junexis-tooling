import type { DiagnosticStory } from './diagnostic-story';

export interface MentorSource {
    file: string;
    line: number;
    column: number;
}

export interface MentorFinding {
    code: string;
    severity: string;
    message: string;
    relatedSymbolId?: string;
    source?: MentorSource;
    explanation?: string;
    recommendedAction?: string;
}

export interface MentorSummary {
    taskCount: number;
    pipelineCount: number;
    narrativeCount: number;
    platformCount: number;
    findingCount: number;
    insightCount: number;
}

export interface MentorInsight {
    kind: string;
    summary: string;
    score?: number;
    relatedSymbolIds: string[];
}

export interface MentorPattern {
    patternId: string;
    name: string;
    confidence: number;
    rationale: string;
    participantSymbolIds: string[];
}

export interface MentorAnalysis {
    schemaVersion: string;
    success: boolean;
    buildId: string;
    snapshotPath: string;
    findings: MentorFinding[];
    summary?: MentorSummary;
    insights?: MentorInsight[];
    patterns?: MentorPattern[];
}

export interface MentorFindingDelta {
    added: number;
    changed: number;
    resolved: number;
    unchanged: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses the deterministic Mentor CLI schema used by Junexis Studio. */
export function parseMentorAnalysis(json: string): MentorAnalysis {
    const value: unknown = JSON.parse(json);
    if (!isRecord(value)) {
        throw new Error('Mentor output must be a JSON object.');
    }
    if (typeof value.schemaVersion !== 'string' || !value.schemaVersion.startsWith('1.')) {
        throw new Error(`Unsupported Mentor schema '${String(value.schemaVersion ?? 'missing')}'. Expected major version 1.`);
    }
    if (value.success !== true || typeof value.buildId !== 'string' || !Array.isArray(value.findings)) {
        throw new Error('Mentor reported an unsuccessful or incomplete analysis.');
    }
    if (value.summary !== undefined && !isRecord(value.summary)) {
        throw new Error('Mentor summary must be a JSON object.');
    }
    if (value.insights !== undefined && !Array.isArray(value.insights)) {
        throw new Error('Mentor insights must be a JSON array.');
    }
    if (value.patterns !== undefined && !Array.isArray(value.patterns)) {
        throw new Error('Mentor patterns must be a JSON array.');
    }
    return value as unknown as MentorAnalysis;
}

/** Rejects Mentor evidence produced for any build other than the active one. */
export function assertCurrentMentorAnalysis(
    analysis: MentorAnalysis,
    activeBuildId: string,
): MentorAnalysis {
    if (analysis.buildId !== activeBuildId) {
        throw new Error('Mentor result buildId does not match the active analysis snapshot.');
    }
    return analysis;
}

/** Mirrors Studio: only stable symbols present in the story may enrich it. */
export function findingsForStory(
    analysis: MentorAnalysis,
    story: DiagnosticStory,
): MentorFinding[] {
    const stableIds = new Set<string>([story.targetTask.symbolId]);
    for (const communication of story.communications) {
        stableIds.add(communication.communicationId);
        stableIds.add(communication.pipelineSymbolId);
        stableIds.add(communication.sourceSymbolId);
        stableIds.add(communication.targetSymbolId);
    }
    return analysis.findings.filter(
        finding => !!finding.relatedSymbolId && stableIds.has(finding.relatedSymbolId));
}

/** Computes the same stable finding delta as Junexis Studio. */
export function mentorFindingDelta(
    previous: MentorFinding[] | undefined,
    current: MentorFinding[],
): MentorFindingDelta {
    const old = new Map((previous ?? []).map(item => [findingIdentity(item), item]));
    const next = new Map(current.map(item => [findingIdentity(item), item]));
    const identities = new Set([...old.keys(), ...next.keys()]);
    const delta: MentorFindingDelta = { added: 0, changed: 0, resolved: 0, unchanged: 0 };
    for (const identity of identities) {
        const before = old.get(identity);
        const after = next.get(identity);
        if (!before) {
            delta.added++;
        } else if (!after) {
            delta.resolved++;
        } else if (JSON.stringify(before) === JSON.stringify(after)) {
            delta.unchanged++;
        } else {
            delta.changed++;
        }
    }
    return delta;
}

function findingIdentity(finding: MentorFinding): string {
    const subject = finding.relatedSymbolId
        ?? (finding.source
            ? `${finding.source.file}:${finding.source.line}:${finding.source.column}`
            : finding.message);
    return `${finding.code}\u001f${subject}`;
}

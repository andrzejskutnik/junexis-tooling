export interface DiagnosticStorySource {
    file: string;
    line: number;
    column: number;
}

export interface DiagnosticStoryTask {
    taskId: number;
    symbolId: string;
    displayName: string;
    resolved: boolean;
    targets: string[];
    output?: string;
    source?: DiagnosticStorySource;
}

export interface DiagnosticStoryEvent {
    eventId: number;
    taskId: number;
    kind: string;
    lamportClock: number;
    vectorClock: Record<string, number>;
    timestamp: string;
    file?: string;
    line?: number;
    function?: string;
    attributes: Record<string, string>;
}

export interface DiagnosticStoryCommunication {
    eventId: number;
    communicationId: string;
    kind: string;
    pipelineSymbolId: string;
    sourceSymbolId: string;
    targetSymbolId: string;
    source?: DiagnosticStorySource;
}

export interface DiagnosticStory {
    schemaVersion: string;
    targetEventId: number;
    targetTask: DiagnosticStoryTask;
    narrativeId?: string;
    timeline: DiagnosticStoryEvent[];
    causalChain: DiagnosticStoryEvent[];
    concurrentEvents: DiagnosticStoryEvent[];
    communications: DiagnosticStoryCommunication[];
    evidence: string[];
}

export interface DiagnosticStoryMentorFinding {
    code: string;
    severity: string;
    message: string;
    relatedSymbolId?: string;
    source?: DiagnosticStorySource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the major-compatible Narrative Diagnostic Story contract. */
export function parseDiagnosticStory(value: unknown): DiagnosticStory {
    if (!isRecord(value)) {
        throw new Error('Diagnostic Story must be a JSON object.');
    }
    if (typeof value.schemaVersion !== 'string' || !value.schemaVersion.startsWith('1.')) {
        throw new Error(
            `Unsupported Diagnostic Story schema '${String(value.schemaVersion ?? 'missing')}'. Expected major version 1.`);
    }
    if (typeof value.targetEventId !== 'number' ||
        !isRecord(value.targetTask) ||
        !Array.isArray(value.timeline) ||
        !Array.isArray(value.causalChain) ||
        !Array.isArray(value.concurrentEvents) ||
        !Array.isArray(value.communications) ||
        !Array.isArray(value.evidence)) {
        throw new Error('Diagnostic Story is missing required fields.');
    }
    return value as unknown as DiagnosticStory;
}

function code(value: unknown): string {
    return `\`${String(value ?? '').replace(/`/g, '\\`')}\``;
}

function eventLines(title: string, events: DiagnosticStoryEvent[]): string[] {
    const lines = [`## ${title}`, ''];
    if (events.length === 0) {
        return [...lines, '_none_', ''];
    }
    for (const event of events) {
        const location = event.file && event.line ? ` · ${code(`${event.file}:${event.line}`)}` : '';
        const narrative = event.attributes?.narrative_id
            ? ` · narrative ${code(event.attributes.narrative_id)}`
            : '';
        lines.push(
            `- ${code(`#${event.eventId}`)} task ${code(event.taskId)} ${code(event.kind)} L=${code(event.lamportClock)}${location}${narrative}`);
    }
    lines.push('');
    return lines;
}

/** Renders the evidence-backed story without presenting Mentor findings as runtime causes. */
export function diagnosticStoryMarkdown(
    story: DiagnosticStory,
    mentorFindings?: DiagnosticStoryMentorFinding[],
): string {
    const lines = [
        `# Diagnostic Story — event #${story.targetEventId}`,
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Schema | ${code(story.schemaVersion)} |`,
        `| Task | ${code(story.targetTask.displayName)} |`,
        `| Symbol | ${code(story.targetTask.symbolId)} |`,
        `| Manifest resolution | ${story.targetTask.resolved ? 'resolved' : 'runtime fallback'} |`,
        `| Narrative | ${code(story.narrativeId ?? 'not captured')} |`,
        '',
        ...eventLines('Timeline', story.timeline),
        ...eventLines('Causal chain', story.causalChain),
        ...eventLines('Concurrent events', story.concurrentEvents),
        '## Junexis communications',
        '',
    ];

    if (story.communications.length === 0) {
        lines.push('_none_', '');
    } else {
        lines.push('| Event | Communication | Kind | Pipeline | Source → Target |', '| --- | --- | --- | --- | --- |');
        for (const communication of story.communications) {
            lines.push(
                `| ${code(`#${communication.eventId}`)} | ${code(communication.communicationId)} | ${code(communication.kind)} | ${code(communication.pipelineSymbolId)} | ${code(communication.sourceSymbolId)} → ${code(communication.targetSymbolId)} |`);
        }
        lines.push('');
    }

    lines.push('## Evidence', '');
    if (story.evidence.length === 0) {
        lines.push('_none_', '');
    } else {
        lines.push(...story.evidence.map(item => `- ${item}`), '');
    }

    lines.push('## Mentor', '');
    if (mentorFindings === undefined) {
        lines.push(
            '_Mentor enrichment is unavailable. Static findings are not treated as runtime causes._',
            '',
        );
    } else if (mentorFindings.length === 0) {
        lines.push(
            '_No Mentor findings match stable symbols in this story. Static findings are not treated as runtime causes._',
            '',
        );
    } else {
        lines.push(
            '_Static findings enrich this story but are not runtime causes._',
            '',
            '| Code | Severity | Symbol | Source | Finding |',
            '| --- | --- | --- | --- | --- |',
        );
        for (const finding of mentorFindings) {
            const source = finding.source
                ? `${finding.source.file}:${finding.source.line}:${finding.source.column}`
                : 'not resolved';
            lines.push(
                `| ${code(finding.code)} | ${code(finding.severity)} | ${code(finding.relatedSymbolId ?? 'global')} | ${code(source)} | ${finding.message.replace(/\|/g, '\\|')} |`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

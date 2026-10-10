import type { MentorAnalysis, MentorFinding } from './mentor-contract';

const yaml = require('js-yaml') as {
    FAILSAFE_SCHEMA: unknown;
    load(text: string, options: { schema: unknown }): unknown;
};

export type MentorPresence = 'quiet' | 'balanced' | 'teaching';

export interface MentorProjectDecision {
    id: string;
    title: string;
    rationale: string;
    relatedSymbolIds: string[];
}

export interface MentorProjectSuppression {
    id: string;
    ruleCode: string;
    symbolId: string;
    rationale: string;
    expiresOn?: string;
}

export interface MentorProjectPolicy {
    schemaVersion: '1.0';
    presence?: MentorPresence;
    decisions: MentorProjectDecision[];
    suppressions: MentorProjectSuppression[];
}

export interface MentorAppliedSuppression {
    suppression: MentorProjectSuppression;
    finding: MentorFinding;
}

export interface MentorPolicyEvaluation {
    result: MentorAnalysis;
    policy: MentorProjectPolicy;
    appliedSuppressions: MentorAppliedSuppression[];
}

function record(value: unknown, context: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${context} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], context: string): void {
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) {
        throw new Error(`${context} contains unknown field '${unknown[0]}'.`);
    }
}

function text(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${field} is required.`);
    }
    return value;
}

function stringArray(value: unknown, field: string): string[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
        throw new Error(`${field} must be an array of non-empty strings.`);
    }
    return value as string[];
}

/** Parses the strict project policy shared with Junexis Studio. */
export function parseMentorProjectPolicy(source: string): MentorProjectPolicy {
    const root = record(yaml.load(source, { schema: yaml.FAILSAFE_SCHEMA }), 'Policy');
    exactKeys(root, ['schemaVersion', 'presence', 'decisions', 'suppressions'], 'Policy');
    if (root.schemaVersion !== '1.0') {
        throw new Error('schemaVersion must be exactly "1.0".');
    }
    if (root.presence !== undefined
        && root.presence !== 'quiet'
        && root.presence !== 'balanced'
        && root.presence !== 'teaching') {
        throw new Error('presence must be quiet, balanced, or teaching.');
    }
    const decisionValues = root.decisions ?? [];
    const suppressionValues = root.suppressions ?? [];
    if (!Array.isArray(decisionValues)) {
        throw new Error('decisions must be an array.');
    }
    if (!Array.isArray(suppressionValues)) {
        throw new Error('suppressions must be an array.');
    }

    const ids = new Set<string>();
    const decisions = decisionValues.map((item, index) => {
        const value = record(item, `Decision ${index + 1}`);
        exactKeys(value, ['id', 'title', 'rationale', 'relatedSymbolIds'], `Decision ${index + 1}`);
        const decision: MentorProjectDecision = {
            id: text(value.id, `Decision ${index + 1} id`),
            title: text(value.title, `Decision ${String(value.id)} title`),
            rationale: text(value.rationale, `Decision ${String(value.id)} rationale`),
            relatedSymbolIds: stringArray(value.relatedSymbolIds, `Decision ${String(value.id)} relatedSymbolIds`),
        };
        if (ids.has(decision.id)) {
            throw new Error(`Duplicate policy id '${decision.id}'.`);
        }
        ids.add(decision.id);
        return decision;
    });

    const targets = new Set<string>();
    const suppressions = suppressionValues.map((item, index) => {
        const value = record(item, `Suppression ${index + 1}`);
        exactKeys(value, ['id', 'ruleCode', 'symbolId', 'rationale', 'expiresOn'], `Suppression ${index + 1}`);
        const suppression: MentorProjectSuppression = {
            id: text(value.id, `Suppression ${index + 1} id`),
            ruleCode: text(value.ruleCode, `Suppression ${String(value.id)} ruleCode`),
            symbolId: text(value.symbolId, `Suppression ${String(value.id)} symbolId`),
            rationale: text(value.rationale, `Suppression ${String(value.id)} rationale`),
            expiresOn: value.expiresOn === undefined
                ? undefined
                : text(value.expiresOn, `Suppression ${String(value.id)} expiresOn`),
        };
        if (!/^M\d{4}$/.test(suppression.ruleCode)) {
            throw new Error(`Suppression '${suppression.id}' ruleCode must match Mxxxx.`);
        }
        if (suppression.expiresOn && !validIsoDate(suppression.expiresOn)) {
            throw new Error(`Suppression '${suppression.id}' expiresOn must use yyyy-MM-dd.`);
        }
        if (ids.has(suppression.id)) {
            throw new Error(`Duplicate policy id '${suppression.id}'.`);
        }
        ids.add(suppression.id);
        const target = `${suppression.ruleCode}\u001f${suppression.symbolId}`;
        if (targets.has(target)) {
            throw new Error(`Multiple suppressions target '${suppression.ruleCode}' and '${suppression.symbolId}'.`);
        }
        targets.add(target);
        return suppression;
    });

    return {
        schemaVersion: '1.0',
        presence: root.presence as MentorPresence | undefined,
        decisions,
        suppressions,
    };
}

/** Applies exact, active suppressions without changing rule meaning or severity. */
export function applyMentorProjectPolicy(
    analysis: MentorAnalysis,
    policy: MentorProjectPolicy,
    today = new Date().toISOString().slice(0, 10),
): MentorPolicyEvaluation {
    const active = policy.suppressions.filter(item => !item.expiresOn || item.expiresOn >= today);
    const appliedSuppressions: MentorAppliedSuppression[] = [];
    const findings = analysis.findings.filter(finding => {
        const suppression = active.find(item =>
            item.ruleCode === finding.code && item.symbolId === finding.relatedSymbolId);
        if (!suppression) {
            return true;
        }
        appliedSuppressions.push({ suppression, finding });
        return false;
    });
    return {
        result: {
            ...analysis,
            findings,
            summary: analysis.summary
                ? { ...analysis.summary, findingCount: findings.length }
                : undefined,
        },
        policy,
        appliedSuppressions,
    };
}

export function emptyMentorProjectPolicy(): MentorProjectPolicy {
    return { schemaVersion: '1.0', decisions: [], suppressions: [] };
}

function validIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

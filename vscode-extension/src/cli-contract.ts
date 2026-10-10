export interface CliDiagnostic {
    code: string;
    level: 'error' | 'warning' | 'info';
    category: string;
    message: string;
    file: string | null;
    line: number;
    column: number;
}

export interface CliBuildOutput {
    schemaVersion: '2.0';
    command: 'build';
    success: boolean;
    durationMs: number;
    inputFile: string;
    diagnostics: CliDiagnostic[];
    mode: string;
    projectRoot: string;
    entryFile: string;
    outputRoot: string | null;
    buildId: string | null;
    targets: string[];
    bundleManifest: string | null;
    artifactManifest: string | null;
    debugManifest: string | null;
    analysisSnapshot: string | null;
    latestBuildReceipt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses the versioned compiler build contract shared with Junexis Studio.
 * JSPI-001 intentionally rejects an unknown schema instead of guessing paths.
 */
export function parseBuildOutput(json: string): CliBuildOutput {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) {
        throw new Error('Junexis build output must be a JSON object.');
    }
    if (parsed.schemaVersion !== '2.0') {
        throw new Error(`Unsupported Junexis build schema '${String(parsed.schemaVersion ?? 'missing')}'. Expected '2.0'.`);
    }
    if (parsed.command !== 'build') {
        throw new Error(`Unexpected Junexis CLI command '${String(parsed.command ?? 'missing')}'. Expected 'build'.`);
    }
    if (typeof parsed.success !== 'boolean' ||
        !Array.isArray(parsed.diagnostics) ||
        !Array.isArray(parsed.targets)) {
        throw new Error('Junexis build output is missing required fields.');
    }

    return parsed as unknown as CliBuildOutput;
}

/** Creates a compact, host-neutral summary for the Output channel. */
export function buildOutputSummary(result: CliBuildOutput): string[] {
    return [
        `Build: ${result.success ? 'succeeded' : 'failed'} (${result.durationMs} ms)`,
        `Schema: ${result.schemaVersion}`,
        `Build ID: ${result.buildId ?? 'not produced'}`,
        `Mode: ${result.mode}`,
        `Project: ${result.projectRoot}`,
        `Entry: ${result.entryFile}`,
        `Output: ${result.outputRoot ?? 'not produced'}`,
        `Targets: ${result.targets.length > 0 ? result.targets.join(', ') : 'none'}`,
        `Bundle manifest: ${result.bundleManifest ?? 'not produced'}`,
        `Artifact manifest: ${result.artifactManifest ?? 'not produced'}`,
        `Debug manifest: ${result.debugManifest ?? 'not produced'}`,
        `Analysis snapshot: ${result.analysisSnapshot ?? 'not produced'}`,
        `Latest-build receipt: ${result.latestBuildReceipt ?? 'not produced'}`,
        `Diagnostics: ${result.diagnostics.length}`,
    ];
}

import * as fs from 'fs';
import * as path from 'path';
import { currentRuntimeIdentifier } from './lsp-distribution';

export const TRACE_COLLECTOR_DISTRIBUTION_SCHEMA_VERSION = 1;
export const SUPPORTED_TRACE_COLLECTOR_PROTOCOL_VERSION = 1;
export const TRACE_COLLECTOR_SERVER_NAME = 'Junexis.Debugger.TraceCollector.Server';
export const TRACE_COLLECTOR_MANIFEST_NAME = 'junexis-trace-collector.json';

export interface TraceCollectorDistributionManifest {
    schemaVersion: number;
    name: string;
    version: string;
    protocolVersion: number;
    runtimeIdentifier: string;
    entrypoint: string;
    readyToRun: boolean;
    selfContained: boolean;
}

export interface TraceCollectorDistribution {
    command: string;
    cwd: string;
    manifestPath: string;
    identity: TraceCollectorDistributionManifest;
}

export function parseTraceCollectorDistributionManifest(
    content: string,
    expectedRuntimeIdentifier: string,
): TraceCollectorDistributionManifest {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value)) {
        throw new Error('TraceCollector distribution manifest must be a JSON object.');
    }

    const manifest: TraceCollectorDistributionManifest = {
        schemaVersion: requireNumber(value, 'schemaVersion'),
        name: requireString(value, 'name'),
        version: requireString(value, 'version'),
        protocolVersion: requireNumber(value, 'protocolVersion'),
        runtimeIdentifier: requireString(value, 'runtimeIdentifier'),
        entrypoint: requireString(value, 'entrypoint'),
        readyToRun: requireBoolean(value, 'readyToRun'),
        selfContained: requireBoolean(value, 'selfContained'),
    };

    if (manifest.schemaVersion !== TRACE_COLLECTOR_DISTRIBUTION_SCHEMA_VERSION) {
        throw new Error(`Unsupported TraceCollector distribution schema ${manifest.schemaVersion}.`);
    }
    if (manifest.name !== TRACE_COLLECTOR_SERVER_NAME) {
        throw new Error(`Unexpected TraceCollector identity ${manifest.name}.`);
    }
    if (manifest.protocolVersion !== SUPPORTED_TRACE_COLLECTOR_PROTOCOL_VERSION) {
        throw new Error(
            `TraceCollector protocol ${manifest.protocolVersion} is incompatible; expected ${SUPPORTED_TRACE_COLLECTOR_PROTOCOL_VERSION}.`);
    }
    if (manifest.runtimeIdentifier !== expectedRuntimeIdentifier) {
        throw new Error(
            `TraceCollector runtime ${manifest.runtimeIdentifier} does not match ${expectedRuntimeIdentifier}.`);
    }
    if (path.basename(manifest.entrypoint) !== manifest.entrypoint) {
        throw new Error('TraceCollector entrypoint must be a file name inside the distribution directory.');
    }

    return manifest;
}

export function resolveTraceCollectorDistribution(
    distributionDirectory: string,
    expectedRuntimeIdentifier: string = currentRuntimeIdentifier(),
): TraceCollectorDistribution {
    const directory = path.resolve(distributionDirectory);
    const manifestPath = path.join(directory, TRACE_COLLECTOR_MANIFEST_NAME);
    const identity = parseTraceCollectorDistributionManifest(
        fs.readFileSync(manifestPath, 'utf8'),
        expectedRuntimeIdentifier);
    const command = path.join(directory, identity.entrypoint);
    if (!fs.statSync(command).isFile()) {
        throw new Error(`TraceCollector entrypoint is not a file: ${command}`);
    }
    return { command, cwd: directory, manifestPath, identity };
}

export function resolveBundledTraceCollector(
    extensionPath: string,
): TraceCollectorDistribution | undefined {
    const directory = path.join(
        extensionPath,
        'runtime',
        'trace-collector',
        currentRuntimeIdentifier());
    if (!fs.existsSync(path.join(directory, TRACE_COLLECTOR_MANIFEST_NAME))) {
        return undefined;
    }
    return resolveTraceCollectorDistribution(directory);
}

export function resolveConfiguredTraceCollector(
    configuredPath: string,
): TraceCollectorDistribution | undefined {
    if (!configuredPath.trim()) {
        return undefined;
    }
    const resolved = path.resolve(configuredPath);
    const directory = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
    const distribution = resolveTraceCollectorDistribution(directory);
    if (!pathsEqual(distribution.command, resolved) && !fs.statSync(resolved).isDirectory()) {
        throw new Error('Configured TraceCollector path does not match the verified distribution entrypoint.');
    }
    return distribution;
}

function pathsEqual(left: string, right: string): boolean {
    const normalizedLeft = path.resolve(left);
    const normalizedRight = path.resolve(right);
    return process.platform === 'win32'
        ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
        : normalizedLeft === normalizedRight;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: Record<string, unknown>, field: string): string {
    const result = value[field];
    if (typeof result !== 'string' || result.length === 0) {
        throw new Error(`TraceCollector distribution field ${field} must be a non-empty string.`);
    }
    return result;
}

function requireNumber(value: Record<string, unknown>, field: string): number {
    const result = value[field];
    if (typeof result !== 'number' || !Number.isInteger(result)) {
        throw new Error(`TraceCollector distribution field ${field} must be an integer.`);
    }
    return result;
}

function requireBoolean(value: Record<string, unknown>, field: string): boolean {
    const result = value[field];
    if (typeof result !== 'boolean') {
        throw new Error(`TraceCollector distribution field ${field} must be a boolean.`);
    }
    return result;
}

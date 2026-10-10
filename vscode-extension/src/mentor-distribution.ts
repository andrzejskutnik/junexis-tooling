import * as fs from 'fs';
import * as path from 'path';
import { currentRuntimeIdentifier } from './lsp-distribution';

export const MENTOR_DISTRIBUTION_SCHEMA_VERSION = 1;
export const SUPPORTED_MENTOR_PROTOCOL_VERSION = 1;
export const MENTOR_HOST_NAME = 'JunexisLang.Mentor.CLI';
export const MENTOR_MANIFEST_NAME = 'junexis-mentor.json';

export interface MentorDistributionManifest {
    schemaVersion: number;
    name: string;
    version: string;
    protocolVersion: number;
    runtimeIdentifier: string;
    entrypoint: string;
    readyToRun: boolean;
    selfContained: boolean;
}

export interface MentorDistribution {
    command: string;
    manifestPath: string;
    identity: MentorDistributionManifest;
}

export function parseMentorDistributionManifest(
    content: string,
    expectedRuntimeIdentifier: string,
): MentorDistributionManifest {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value)) {
        throw new Error('Mentor distribution manifest must be a JSON object.');
    }
    const manifest: MentorDistributionManifest = {
        schemaVersion: requireNumber(value, 'schemaVersion'),
        name: requireString(value, 'name'),
        version: requireString(value, 'version'),
        protocolVersion: requireNumber(value, 'protocolVersion'),
        runtimeIdentifier: requireString(value, 'runtimeIdentifier'),
        entrypoint: requireString(value, 'entrypoint'),
        readyToRun: requireBoolean(value, 'readyToRun'),
        selfContained: requireBoolean(value, 'selfContained'),
    };
    if (manifest.schemaVersion !== MENTOR_DISTRIBUTION_SCHEMA_VERSION) {
        throw new Error(`Unsupported Mentor distribution schema ${manifest.schemaVersion}.`);
    }
    if (manifest.name !== MENTOR_HOST_NAME) {
        throw new Error(`Unexpected Mentor identity ${manifest.name}.`);
    }
    if (manifest.protocolVersion !== SUPPORTED_MENTOR_PROTOCOL_VERSION) {
        throw new Error(
            `Mentor protocol ${manifest.protocolVersion} is incompatible; expected ${SUPPORTED_MENTOR_PROTOCOL_VERSION}.`);
    }
    if (manifest.runtimeIdentifier !== expectedRuntimeIdentifier) {
        throw new Error(`Mentor runtime ${manifest.runtimeIdentifier} does not match ${expectedRuntimeIdentifier}.`);
    }
    if (path.basename(manifest.entrypoint) !== manifest.entrypoint) {
        throw new Error('Mentor entrypoint must be a file name inside the distribution directory.');
    }
    return manifest;
}

export function resolveBundledMentor(extensionPath: string): MentorDistribution | undefined {
    const directory = path.join(extensionPath, 'runtime', 'mentor', currentRuntimeIdentifier());
    const manifestPath = path.join(directory, MENTOR_MANIFEST_NAME);
    if (!fs.existsSync(manifestPath)) {
        return undefined;
    }
    const identity = parseMentorDistributionManifest(
        fs.readFileSync(manifestPath, 'utf8'),
        currentRuntimeIdentifier());
    const command = path.join(directory, identity.entrypoint);
    if (!fs.existsSync(command) || !fs.statSync(command).isFile()) {
        return undefined;
    }
    return { command, manifestPath, identity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: Record<string, unknown>, field: string): string {
    const result = value[field];
    if (typeof result !== 'string' || result.length === 0) {
        throw new Error(`Mentor distribution field ${field} must be a non-empty string.`);
    }
    return result;
}

function requireNumber(value: Record<string, unknown>, field: string): number {
    const result = value[field];
    if (typeof result !== 'number' || !Number.isInteger(result)) {
        throw new Error(`Mentor distribution field ${field} must be an integer.`);
    }
    return result;
}

function requireBoolean(value: Record<string, unknown>, field: string): boolean {
    const result = value[field];
    if (typeof result !== 'boolean') {
        throw new Error(`Mentor distribution field ${field} must be a boolean.`);
    }
    return result;
}

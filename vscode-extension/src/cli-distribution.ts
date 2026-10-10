import * as fs from 'fs';
import * as path from 'path';
import { currentRuntimeIdentifier } from './lsp-distribution';

export const CLI_DISTRIBUTION_SCHEMA_VERSION = 1;
export const SUPPORTED_CLI_PROTOCOL_VERSION = 2;
export const CLI_HOST_NAME = 'JunexisLang.Compiler.CLI';
export const CLI_MANIFEST_NAME = 'junexis-cli.json';

export interface CliDistributionManifest {
    schemaVersion: number;
    name: string;
    version: string;
    protocolVersion: number;
    runtimeIdentifier: string;
    entrypoint: string;
    readyToRun: boolean;
    selfContained: boolean;
}

export interface CliDistribution {
    command: string;
    manifestPath: string;
    identity: CliDistributionManifest;
}

export function parseCliDistributionManifest(
    content: string,
    expectedRuntimeIdentifier: string,
): CliDistributionManifest {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value)) {
        throw new Error('CLI distribution manifest must be a JSON object.');
    }

    const manifest: CliDistributionManifest = {
        schemaVersion: requireNumber(value, 'schemaVersion'),
        name: requireString(value, 'name'),
        version: requireString(value, 'version'),
        protocolVersion: requireNumber(value, 'protocolVersion'),
        runtimeIdentifier: requireString(value, 'runtimeIdentifier'),
        entrypoint: requireString(value, 'entrypoint'),
        readyToRun: requireBoolean(value, 'readyToRun'),
        selfContained: requireBoolean(value, 'selfContained'),
    };

    if (manifest.schemaVersion !== CLI_DISTRIBUTION_SCHEMA_VERSION) {
        throw new Error(`Unsupported CLI distribution schema ${manifest.schemaVersion}.`);
    }
    if (manifest.name !== CLI_HOST_NAME) {
        throw new Error(`Unexpected CLI identity ${manifest.name}.`);
    }
    if (manifest.protocolVersion !== SUPPORTED_CLI_PROTOCOL_VERSION) {
        throw new Error(
            `CLI protocol ${manifest.protocolVersion} is incompatible; expected ${SUPPORTED_CLI_PROTOCOL_VERSION}.`);
    }
    if (manifest.runtimeIdentifier !== expectedRuntimeIdentifier) {
        throw new Error(`CLI runtime ${manifest.runtimeIdentifier} does not match ${expectedRuntimeIdentifier}.`);
    }
    if (path.basename(manifest.entrypoint) !== manifest.entrypoint) {
        throw new Error('CLI entrypoint must be a file name inside the distribution directory.');
    }

    return manifest;
}

export function resolveBundledCli(extensionPath: string): CliDistribution | undefined {
    const directory = path.join(extensionPath, 'runtime', 'cli', currentRuntimeIdentifier());
    const manifestPath = path.join(directory, CLI_MANIFEST_NAME);
    if (!fs.existsSync(manifestPath)) {
        return undefined;
    }
    const identity = parseCliDistributionManifest(
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
        throw new Error(`CLI distribution field ${field} must be a non-empty string.`);
    }
    return result;
}

function requireNumber(value: Record<string, unknown>, field: string): number {
    const result = value[field];
    if (typeof result !== 'number' || !Number.isInteger(result)) {
        throw new Error(`CLI distribution field ${field} must be an integer.`);
    }
    return result;
}

function requireBoolean(value: Record<string, unknown>, field: string): boolean {
    const result = value[field];
    if (typeof result !== 'boolean') {
        throw new Error(`CLI distribution field ${field} must be a boolean.`);
    }
    return result;
}

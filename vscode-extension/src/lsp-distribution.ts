import * as path from 'path';

export const SUPPORTED_LSP_PROTOCOL_VERSION = 1;
export const LSP_DISTRIBUTION_SCHEMA_VERSION = 1;
export const LSP_HOST_NAME = 'JunexisLang.Compiler.LspHost';

export interface LspDistributionManifest {
    schemaVersion: number;
    name: string;
    version: string;
    protocolVersion: number;
    runtimeIdentifier: string;
    entrypoint: string;
    readyToRun: boolean;
    selfContained: boolean;
}

export interface LspCompatibility {
    compatible: boolean;
    message: string;
}

export function currentRuntimeIdentifier(
    platform: NodeJS.Platform = process.platform,
    architecture: string = process.arch,
): string {
    if (platform === 'win32' && architecture === 'x64') {
        return 'win-x64';
    }
    if (platform === 'linux' && architecture === 'x64') {
        return 'linux-x64';
    }
    if (platform === 'darwin' && architecture === 'arm64') {
        return 'osx-arm64';
    }

    throw new Error(`Platforma ${platform}-${architecture} nie należy do macierzy wydania Junexis.`);
}

export function parseLspDistributionManifest(
    content: string,
    expectedRuntimeIdentifier: string,
): LspDistributionManifest {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value)) {
        throw new Error('LSP distribution manifest must be a JSON object.');
    }

    const manifest: LspDistributionManifest = {
        schemaVersion: requireNumber(value, 'schemaVersion'),
        name: requireString(value, 'name'),
        version: requireString(value, 'version'),
        protocolVersion: requireNumber(value, 'protocolVersion'),
        runtimeIdentifier: requireString(value, 'runtimeIdentifier'),
        entrypoint: requireString(value, 'entrypoint'),
        readyToRun: requireBoolean(value, 'readyToRun'),
        selfContained: requireBoolean(value, 'selfContained'),
    };

    if (manifest.schemaVersion !== LSP_DISTRIBUTION_SCHEMA_VERSION) {
        throw new Error(`Unsupported LSP distribution schema ${manifest.schemaVersion}.`);
    }
    if (manifest.name !== LSP_HOST_NAME) {
        throw new Error(`Unexpected LSP host identity ${manifest.name}.`);
    }
    if (manifest.runtimeIdentifier !== expectedRuntimeIdentifier) {
        throw new Error(
            `LSP runtime ${manifest.runtimeIdentifier} does not match ${expectedRuntimeIdentifier}.`,
        );
    }
    if (path.basename(manifest.entrypoint) !== manifest.entrypoint) {
        throw new Error('LSP entrypoint must be a file name inside the distribution directory.');
    }

    return manifest;
}

export function checkLspCompatibility(
    manifest: LspDistributionManifest,
): LspCompatibility {
    if (manifest.protocolVersion !== SUPPORTED_LSP_PROTOCOL_VERSION) {
        return {
            compatible: false,
            message: `protocol ${manifest.protocolVersion} is incompatible; expected ${SUPPORTED_LSP_PROTOCOL_VERSION}`,
        };
    }

    return {
        compatible: true,
        message: `protocol ${manifest.protocolVersion} compatible`,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: Record<string, unknown>, field: string): string {
    const result = value[field];
    if (typeof result !== 'string' || result.length === 0) {
        throw new Error(`LSP distribution field ${field} must be a non-empty string.`);
    }
    return result;
}

function requireNumber(value: Record<string, unknown>, field: string): number {
    const result = value[field];
    if (typeof result !== 'number' || !Number.isInteger(result)) {
        throw new Error(`LSP distribution field ${field} must be an integer.`);
    }
    return result;
}

function requireBoolean(value: Record<string, unknown>, field: string): boolean {
    const result = value[field];
    if (typeof result !== 'boolean') {
        throw new Error(`LSP distribution field ${field} must be a boolean.`);
    }
    return result;
}

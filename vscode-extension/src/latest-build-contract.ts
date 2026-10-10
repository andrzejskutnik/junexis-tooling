import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { parseArtifactInventory } from './artifact-contract';
import type { CliBuildOutput } from './cli-contract';

export interface LatestBuildReceipt {
    schemaVersion: '1.0';
    buildId: string;
    mode: 'project' | 'file';
    projectRoot: string;
    entryFile: string;
    outputRoot: string;
    targets: string[];
    bundleManifest: string;
    artifactManifest: string;
    debugManifest: string;
    analysisSnapshot: string;
    receiptPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireAbsolute(value: unknown, property: string): string {
    if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
        throw new Error(`Latest-build ${property} must be an absolute path.`);
    }
    return path.resolve(value);
}

function requireChild(root: string, value: unknown, property: string): string {
    const child = requireAbsolute(value, property);
    const relative = path.relative(root, child);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Latest-build ${property} escapes its owning root.`);
    }
    return child;
}

function pathsEqual(left: string, right: string): boolean {
    const normalizedLeft = path.resolve(left).replace(/[\\/]+$/, '');
    const normalizedRight = path.resolve(right).replace(/[\\/]+$/, '');
    return process.platform === 'win32'
        ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
        : normalizedLeft === normalizedRight;
}

/** Returns the compiler-owned deterministic receipt location without scanning output folders. */
export function latestBuildReceiptPath(
    mode: 'project' | 'file',
    projectRoot: string,
    entryFile: string,
): string {
    const stateRoot = path.join(path.resolve(projectRoot), '.junexis', 'state');
    return mode === 'project'
        ? path.join(stateRoot, 'latest-build.json')
        : path.join(stateRoot, path.parse(entryFile).name, 'latest-build.json');
}

/** Parses and confines the durable latest-build 1.0 contract. */
export function parseLatestBuildReceipt(json: string, receiptPath: string): LatestBuildReceipt {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) {
        throw new Error('Latest-build receipt must be a JSON object.');
    }
    if (parsed.schemaVersion !== '1.0') {
        throw new Error(
            `Unsupported latest-build schema '${String(parsed.schemaVersion ?? 'missing')}'. Expected '1.0'.`);
    }
    if (typeof parsed.buildId !== 'string' || !/^[0-9a-fA-F]{64}$/.test(parsed.buildId)) {
        throw new Error('Latest-build buildId must be a 64-character SHA-256.');
    }
    if (parsed.mode !== 'project' && parsed.mode !== 'file') {
        throw new Error("Latest-build mode must be 'project' or 'file'.");
    }
    if (!Array.isArray(parsed.targets) ||
        parsed.targets.length === 0 ||
        parsed.targets.some(target => typeof target !== 'string' || !target.trim())) {
        throw new Error('Latest-build receipt has no valid targets.');
    }

    const projectRoot = requireAbsolute(parsed.projectRoot, 'projectRoot');
    const entryFile = requireChild(projectRoot, parsed.entryFile, 'entryFile');
    const outputRoot = requireAbsolute(parsed.outputRoot, 'outputRoot');
    const bundleManifest = requireChild(outputRoot, parsed.bundleManifest, 'bundleManifest');
    const artifactManifest = requireChild(outputRoot, parsed.artifactManifest, 'artifactManifest');
    const debugManifest = requireChild(outputRoot, parsed.debugManifest, 'debugManifest');
    const analysisSnapshot = requireChild(outputRoot, parsed.analysisSnapshot, 'analysisSnapshot');
    const fullReceiptPath = path.resolve(receiptPath);
    const expectedPath = latestBuildReceiptPath(parsed.mode, projectRoot, entryFile);
    if (!pathsEqual(fullReceiptPath, expectedPath)) {
        throw new Error('Latest-build receipt is outside its deterministic state location.');
    }

    return {
        schemaVersion: '1.0',
        buildId: parsed.buildId,
        mode: parsed.mode,
        projectRoot,
        entryFile,
        outputRoot,
        targets: parsed.targets as string[],
        bundleManifest,
        artifactManifest,
        debugManifest,
        analysisSnapshot,
        receiptPath: fullReceiptPath,
    };
}

async function requireBuildIdentity(
    artifactPath: string,
    expectedBuildId: string,
    property: string,
): Promise<void> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    } catch (error) {
        throw new Error(
            `Latest-build ${property} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(parsed) || parsed.buildId !== expectedBuildId) {
        throw new Error(`Latest-build ${property} buildId does not match the receipt.`);
    }
}

/** Loads a receipt only after every referenced artifact and build identity is verified. */
export async function loadLatestBuildReceipt(receiptPath: string): Promise<LatestBuildReceipt> {
    const receipt = parseLatestBuildReceipt(await fs.readFile(receiptPath, 'utf8'), receiptPath);
    await Promise.all([
        requireBuildIdentity(receipt.bundleManifest, receipt.buildId, 'bundleManifest'),
        requireBuildIdentity(receipt.artifactManifest, receipt.buildId, 'artifactManifest'),
        requireBuildIdentity(receipt.analysisSnapshot, receipt.buildId, 'analysisSnapshot'),
        fs.access(receipt.debugManifest).catch(error => {
            throw new Error(
                `Latest-build debugManifest cannot be read: ${error instanceof Error ? error.message : String(error)}`);
        }),
    ]);
    const inventory = parseArtifactInventory(
        await fs.readFile(receipt.artifactManifest, 'utf8'),
        receipt.artifactManifest);
    const debugArtifact = inventory.items.find(item => pathsEqual(item.fullPath, receipt.debugManifest));
    if (!debugArtifact || debugArtifact.kind !== 'debug-manifest') {
        throw new Error('Latest-build debugManifest is not declared by the artifact inventory.');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(debugArtifact.sha256)) {
        throw new Error('Latest-build debugManifest inventory hash is not a SHA-256.');
    }
    const actualDebugHash = createHash('sha256')
        .update(await fs.readFile(receipt.debugManifest))
        .digest('hex');
    if (actualDebugHash.toLowerCase() !== debugArtifact.sha256.toLowerCase()) {
        throw new Error('Latest-build debugManifest SHA-256 does not match the artifact inventory.');
    }
    return receipt;
}

/** Projects a verified durable receipt onto the compatibility state consumed by extension views. */
export function buildOutputFromReceipt(
    receipt: LatestBuildReceipt,
    source?: CliBuildOutput,
): CliBuildOutput {
    return {
        schemaVersion: '2.0',
        command: 'build',
        success: true,
        durationMs: source?.durationMs ?? 0,
        inputFile: source?.inputFile ?? (receipt.mode === 'project' ? receipt.projectRoot : receipt.entryFile),
        diagnostics: source?.diagnostics ?? [],
        mode: receipt.mode,
        projectRoot: receipt.projectRoot,
        entryFile: receipt.entryFile,
        outputRoot: receipt.outputRoot,
        buildId: receipt.buildId,
        targets: [...receipt.targets],
        bundleManifest: receipt.bundleManifest,
        artifactManifest: receipt.artifactManifest,
        debugManifest: receipt.debugManifest,
        analysisSnapshot: receipt.analysisSnapshot,
        latestBuildReceipt: receipt.receiptPath,
    };
}

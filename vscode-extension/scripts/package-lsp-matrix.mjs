import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const distributionTargets = Object.freeze([
  Object.freeze({ runtimeIdentifier: "win-x64", vsceTarget: "win32-x64" }),
  Object.freeze({ runtimeIdentifier: "linux-x64", vsceTarget: "linux-x64" }),
  Object.freeze({ runtimeIdentifier: "osx-arm64", vsceTarget: "darwin-arm64" }),
]);

const scriptPath = fileURLToPath(import.meta.url);
const extensionRoot = dirname(dirname(scriptPath));
const require = createRequire(import.meta.url);

export function validateDistributionManifest(manifest, expectedRuntimeIdentifier) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error(`Unsupported LspHost distribution schema: ${manifest?.schemaVersion}`);
  }
  if (manifest.name !== "JunexisLang.Compiler.LspHost") {
    throw new Error(`Unexpected LspHost identity: ${manifest.name}`);
  }
  if (manifest.protocolVersion !== 1) {
    throw new Error(
      `LspHost protocol ${manifest.protocolVersion} is incompatible with extension protocol 1.`,
    );
  }
  if (manifest.runtimeIdentifier !== expectedRuntimeIdentifier) {
    throw new Error(
      `LspHost runtime ${manifest.runtimeIdentifier} does not match requested ${expectedRuntimeIdentifier}.`,
    );
  }
  if (manifest.selfContained !== true) {
    throw new Error(
      `Production LspHost distribution ${expectedRuntimeIdentifier} must be self-contained.`,
    );
  }
  if (
    typeof manifest.entrypoint !== "string"
    || manifest.entrypoint.length === 0
    || manifest.entrypoint.includes("/")
    || manifest.entrypoint.includes("\\")
  ) {
    throw new Error(`Invalid LspHost entrypoint: ${manifest.entrypoint}`);
  }

  return manifest;
}

function parseArguments(args) {
  if (args.includes("--help")) {
    return { help: true };
  }

  const valueAfter = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const distributionsRoot = valueAfter("--root");
  if (!distributionsRoot) {
    throw new Error("Usage: node scripts/package-lsp-matrix.mjs --root <directory> [--output-dir <directory>]");
  }

  return {
    help: false,
    distributionsRoot: resolve(distributionsRoot),
    outputDirectory: resolve(valueAfter("--output-dir") ?? extensionRoot),
  };
}

async function runVsce(vsceTarget, outputPath) {
  const vscePackageModule = join(
    extensionRoot,
    "node_modules",
    "@vscode",
    "vsce",
    "out",
    "package.js",
  );
  if (!existsSync(vscePackageModule)) {
    throw new Error("Local @vscode/vsce is missing. Run npm ci before packaging.");
  }

  const { pack } = require(vscePackageModule);
  await pack({
    allowMissingRepository: true,
    cwd: extensionRoot,
    dependencies: false,
    packagePath: outputPath,
    target: vsceTarget,
    useYarn: false,
  });
}

export async function packageDistributionMatrix(distributionsRoot, outputDirectory) {
  const bundledExtension = join(extensionRoot, "dist", "extension.js");
  if (!existsSync(bundledExtension)) {
    throw new Error(
      "Bundled extension is missing. Run npm run vscode:prepublish before packaging the matrix.",
    );
  }

  const packageJson = JSON.parse(
    readFileSync(join(extensionRoot, "package.json"), "utf8"),
  );
  const runtimeRoot = resolve(extensionRoot, "runtime");
  const expectedRuntimeRoot = resolve(join(extensionRoot, "runtime"));

  if (runtimeRoot !== expectedRuntimeRoot) {
    throw new Error(`Refusing unexpected staging path: ${runtimeRoot}`);
  }
  if (existsSync(runtimeRoot)) {
    throw new Error(`Refusing to replace an existing extension runtime directory: ${runtimeRoot}`);
  }

  mkdirSync(outputDirectory, { recursive: true });
  const outputs = [];

  for (const target of distributionTargets) {
    const variantRoot = join(distributionsRoot, target.runtimeIdentifier);
    const structuredSource = join(variantRoot, "lsp");
    const source = existsSync(structuredSource) ? structuredSource : variantRoot;
    const manifestPath = join(source, "junexis-lsp.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`LspHost distribution manifest was not found: ${manifestPath}`);
    }

    const manifest = validateDistributionManifest(
      JSON.parse(readFileSync(manifestPath, "utf8")),
      target.runtimeIdentifier,
    );
    const entrypoint = join(source, manifest.entrypoint);
    if (!existsSync(entrypoint)) {
      throw new Error(`LspHost entrypoint was not found: ${entrypoint}`);
    }

    const stage = join(runtimeRoot, "lsp", target.runtimeIdentifier);
    const outputPath = join(
      outputDirectory,
      `junexislang-${packageJson.version}-${target.vsceTarget}.vsix`,
    );

    try {
      mkdirSync(stage, { recursive: true });
      cpSync(source, stage, { recursive: true });
      await runVsce(target.vsceTarget, outputPath);
      outputs.push(outputPath);
    } finally {
      if (existsSync(runtimeRoot)) {
        const resolvedStage = resolve(runtimeRoot);
        if (resolvedStage !== expectedRuntimeRoot) {
          throw new Error(`Refusing to remove unexpected staging path: ${resolvedStage}`);
        }
        rmSync(resolvedStage, { recursive: true, force: true });
      }
    }
  }

  return outputs;
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: node scripts/package-lsp-matrix.mjs --root <directory> [--output-dir <directory>]",
      );
    } else {
      const outputs = await packageDistributionMatrix(
        options.distributionsRoot,
        options.outputDirectory,
      );
      for (const output of outputs) {
        console.log(output);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

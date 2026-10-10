import assert from "node:assert/strict";
import test from "node:test";
import {
  distributionTargets,
  validateDistributionManifest,
} from "../scripts/package-lsp-matrix.mjs";

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    name: "JunexisLang.Compiler.LspHost",
    version: "0.1.0",
    protocolVersion: 1,
    runtimeIdentifier: "linux-x64",
    entrypoint: "JunexisLang.Compiler.LspHost",
    readyToRun: true,
    selfContained: true,
    ...overrides,
  };
}

test("release matrix maps every supported LSP runtime to a VS Code target", () => {
  assert.deepEqual(distributionTargets, [
    { runtimeIdentifier: "win-x64", vsceTarget: "win32-x64" },
    { runtimeIdentifier: "linux-x64", vsceTarget: "linux-x64" },
    { runtimeIdentifier: "osx-arm64", vsceTarget: "darwin-arm64" },
  ]);
});

test("release packaging accepts a compatible self-contained distribution", () => {
  assert.equal(
    validateDistributionManifest(manifest(), "linux-x64").runtimeIdentifier,
    "linux-x64",
  );
});

test("release packaging rejects unsafe or incomplete distributions", () => {
  assert.throws(
    () => validateDistributionManifest(manifest({ selfContained: false }), "linux-x64"),
    /self-contained/,
  );
  assert.throws(
    () => validateDistributionManifest(manifest({ entrypoint: "../host" }), "linux-x64"),
    /entrypoint/,
  );
  assert.throws(
    () => validateDistributionManifest(manifest(), "osx-arm64"),
    /does not match/,
  );
});

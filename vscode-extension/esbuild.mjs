import { build } from "esbuild";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = dirname(fileURLToPath(import.meta.url));

await build({
  absWorkingDir: extensionRoot,
  entryPoints: ["./src/extension.ts"],
  outfile: "./dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  minify: true,
  sourcemap: false,
  legalComments: "eof",
  logLevel: "info",
});

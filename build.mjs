import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

const common = { outdir: "dist", bundle: true, target: "chrome120", logLevel: "info" };

const scripts = {
  ...common,
  entryPoints: {
    main: "src/main/index.js",
    content: "src/content/index.js",
    popup: "src/popup/popup.js",
    background: "src/background/index.js",
  },
  format: "iife",
};

// pdf.js is ESM-only (top-level await), so the doc frame is an ES module.
const docframe = { ...common, entryPoints: { docframe: "src/docframe/index.js" }, format: "esm" };

mkdirSync("dist", { recursive: true });
cpSync("static", "dist", { recursive: true });
const PDFJS = "node_modules/pdfjs-dist";
cpSync(`${PDFJS}/build/pdf.worker.min.mjs`, "dist/pdf.worker.min.mjs");
for (const dir of ["standard_fonts", "cmaps", "wasm"]) cpSync(`${PDFJS}/${dir}`, `dist/${dir}`, { recursive: true });

if (watch) {
  for (const options of [scripts, docframe]) await (await esbuild.context(options)).watch();
} else {
  await Promise.all([esbuild.build(scripts), esbuild.build(docframe)]);
}

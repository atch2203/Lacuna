import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: {
    main: "src/main/index.js",
    content: "src/content/index.js",
    popup: "src/popup/popup.js",
    background: "src/background/index.js",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  logLevel: "info",
};

mkdirSync("dist", { recursive: true });
cpSync("static", "dist", { recursive: true });

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}

// soksak-plugin-acp-studio 번들 — esbuild 단일 ESM main.js. plain DOM(번들 의존 0, 가벼움).
import { build, context } from "esbuild";
const opts = {
  entryPoints: ["src/main.ts"], bundle: true, format: "esm", platform: "browser",
  target: "es2022", define: { "process.env.NODE_ENV": '"production"' },
  outfile: "main.js", minify: false, legalComments: "none", logLevel: "info",
};
if (process.argv.includes("--watch")) { const c = await context(opts); await c.watch(); console.log("[agents-clubhouse] watching …"); }
else { await build(opts); console.log("[agents-clubhouse] built main.js"); }

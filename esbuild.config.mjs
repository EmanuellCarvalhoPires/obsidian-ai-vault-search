import esbuild from "esbuild";
import process from "process";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

// jszip pulls in the "immediate" and "setimmediate" polyfills, which create <script> elements at runtime
// (old-browser fallbacks). Replace them with minimal shims based on queueMicrotask / setTimeout.
const semPolyfillScript = {
  name: "sem-polyfill-script",
  setup(build) {
    // The "browser" field of jszip points to a prebuilt dist that embeds those polyfills: use the sources instead.
    build.onResolve({ filter: /^jszip$/ }, () => ({
      path: fileURLToPath(new URL("./node_modules/jszip/lib/index.js", import.meta.url)),
    }));
    build.onResolve({ filter: /^(immediate|setimmediate)$/ }, (args) => ({
      path: args.path,
      namespace: "shim-async",
    }));
    build.onLoad({ filter: /.*/, namespace: "shim-async" }, (args) => ({
      contents:
        args.path === "immediate"
          ? "module.exports = function immediate(fn) { queueMicrotask(fn); };"
          : "if (typeof globalThis.setImmediate !== 'function') { globalThis.setImmediate = function (fn, ...a) { return setTimeout(fn, 0, ...a); }; globalThis.clearImmediate = function (h) { clearTimeout(h); }; }",
      loader: "js",
    }));
  },
};

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  plugins: [semPolyfillScript],
  alias: { "readable-stream": "./node_modules/jszip/lib/readable-stream-browser.js" },
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}

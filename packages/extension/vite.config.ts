import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
/**
 * `dist/` by default; `OUT_DIR` lets the release packager build every target
 * side by side instead of overwriting one directory three times (Safari in
 * particular needs its unpacked tree to survive — Xcode's converter reads it).
 */
const outDir = process.env.OUT_DIR ? resolve(process.env.OUT_DIR) : resolve(root, 'dist');

/** chrome (default) | firefox | safari — chooses which manifest ships as manifest.json. */
const TARGETS = ['chrome', 'firefox', 'safari'] as const;
const requested = process.env.TARGET ?? 'chrome';
if (!TARGETS.includes(requested as (typeof TARGETS)[number])) {
  throw new Error(`TARGET must be one of ${TARGETS.join(', ')} — got "${requested}"`);
}
const target = requested as (typeof TARGETS)[number];

/**
 * Copy the non-bundled extension assets into dist after the JS build:
 *   - manifest/manifest.<target>.json -> dist/manifest.json
 *   - src/popup/index.html            -> dist/popup/index.html
 *   - src/approval/index.html         -> dist/approval/index.html
 *   - public/icons/*                  -> dist/icons/*
 *
 * The popup/approval HTML reference `./main.js`; the build below emits
 * `popup/main.js` and `approval/main.js`, and the manifest references
 * `background/index.js`, `content/bridge.js` and `inpage/provider.js` — all
 * stable and unhashed.
 */
function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      copyFileSync(resolve(root, `manifest/manifest.${target}.json`), resolve(outDir, 'manifest.json'));
      for (const page of ['popup', 'approval']) {
        mkdirSync(resolve(outDir, page), { recursive: true });
        copyFileSync(resolve(root, `src/${page}/index.html`), resolve(outDir, `${page}/index.html`));
      }
      cpSync(resolve(root, 'public/icons'), resolve(outDir, 'icons'), { recursive: true });
      // eslint-disable-next-line no-console
      console.log(`\n[extension] assembled dist/ for target=${target}`);
    },
  };
}

export default defineConfig({
  root,
  plugins: [copyExtensionAssets()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        'background/index': resolve(root, 'src/background/index.ts'),
        'popup/main': resolve(root, 'src/popup/main.ts'),
        'approval/main': resolve(root, 'src/approval/main.ts'),
        // The content script is loaded as a CLASSIC script (MV3 does not
        // support `type: module` content scripts), so it must stay
        // import-free — enforced by src/__tests__/packaging.test.ts.
        'content/bridge': resolve(root, 'src/content/bridge.ts'),
        // Injected into the page with `<script type="module">`, so ESM is fine.
        'inpage/provider': resolve(root, 'src/inpage/provider.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
      preserveEntrySignatures: 'allow-extension',
    },
  },
});

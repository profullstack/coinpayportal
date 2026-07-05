import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(root, 'dist');

/** chrome (default) | firefox — chooses which manifest ships as manifest.json. */
const target = process.env.TARGET === 'firefox' ? 'firefox' : 'chrome';

/**
 * Copy the non-bundled extension assets into dist after the JS build:
 *   - manifest/manifest.<target>.json -> dist/manifest.json
 *   - src/popup/index.html            -> dist/popup/index.html
 *   - public/icons/*                  -> dist/icons/*
 *
 * The popup HTML references `./main.js`; the build below emits `popup/main.js`,
 * and the manifest references `background/index.js` — both stable, unhashed.
 */
function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      copyFileSync(resolve(root, `manifest/manifest.${target}.json`), resolve(outDir, 'manifest.json'));
      mkdirSync(resolve(outDir, 'popup'), { recursive: true });
      copyFileSync(resolve(root, 'src/popup/index.html'), resolve(outDir, 'popup/index.html'));
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
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});

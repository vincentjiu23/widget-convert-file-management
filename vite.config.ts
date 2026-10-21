import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isTest = process.env.VITEST || mode === 'test';

  return {
    plugins: [
      react(),
      ...(!isTest
        ? [
            electron([
              {
                entry: 'src/main/index.ts',
                onstart(options) {
                  options.startup();
                },
                vite: {
                  build: {
                    outDir: 'dist-electron/main',
                    rollupOptions: {
                      external: ['electron', 'sql.js', 'sharp']
                    }
                  }
                }
              },
              {
                entry: 'src/preload/index.ts',
                onstart(options) {
                  options.reload();
                },
                vite: {
                  build: {
                    outDir: 'dist-electron/preload'
                  }
                }
              }
            ]),
            renderer()
          ]
        : [])
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    },
    test: {
      globals: true,
      environment: 'node'
    }
  };
});

import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty', 'electron-store']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          petOverlay: resolve('src/preload/petOverlay.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@types': resolve('src/types')
      }
    },
    plugins: [react()],
    css: {
      postcss: './postcss.config.cjs'
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          petOverlay: resolve('src/renderer/pet-overlay/index.html')
        }
      }
    }
  }
})

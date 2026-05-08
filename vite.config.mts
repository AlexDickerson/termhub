import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Orchestrator subagents create git worktrees under
      // .claude/worktrees/<branch>/, each a full duplicate of the
      // termhub source. Without this, Vite's chokidar picks up the
      // duplicate index.html / tsconfig and force-reloads the page.
      // Vite's default ignored is replaced (not merged), so re-state
      // the standard ignores.
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/.claude/**',
      ],
    },
  },
})

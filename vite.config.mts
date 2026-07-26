import { defineConfig, configDefaults } from 'vitest/config'
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
  test: {
    // Same rationale as server.watch.ignored above: orchestrator subagents
    // leave full source copies under .claude/worktrees/<branch>/. Without
    // this, vitest collects and runs every worktree's copy of the suite
    // alongside the real one — duplicate work, and any test that binds a
    // fixed port fails with EADDRINUSE against its own clone.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
})

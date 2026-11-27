import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The production build is ONE self-contained dist/index.html (scripts, styles,
// fonts and the bundled floor plan inlined). It can be opened by double-click,
// e-mailed, or put on any static host or intranet page.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  // VITE_* as usual, plus the public variables Vercel's Supabase integration sets
  // (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY). Never widen this to secrets
  // such as SUPABASE_SERVICE_ROLE_KEY: whatever matches ends up in the page.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_SUPABASE_'],
  server: { port: 5183, strictPort: true },
  preview: { port: 5184, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})

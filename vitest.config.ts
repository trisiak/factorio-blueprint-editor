import { defineConfig } from 'vitest/config'

// Unit tests cover framework-free logic (e.g. gesture geometry). The PixiJS
// rendering layer is verified by running the app, not here.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['packages/**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**', 'packages/exporter/**'],
    },
})

import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.recommended, // TODO: try strict & strictTypeChecked
    {
        rules: {
            '@typescript-eslint/ban-ts-comment': 'off', // TODO: remove
            '@typescript-eslint/no-explicit-any': 'off', // TODO: remove
        },
    },
    {
        // build/config files run in Node and read process.env
        files: ['**/*.config.{js,mjs,cjs}'],
        languageOptions: {
            globals: { process: 'readonly' },
        },
    },
    {
        ignores: [
            'packages/website/dist',
            'packages/editor/src/basis',
            'packages/exporter',
            'functions/corsproxy.js',
        ],
    }
)

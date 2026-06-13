// The repo's tsconfig deliberately carries no node types (the app is
// browser-only). Node-env vitest tests (the sprite census) still need to read
// committed pack fixtures from disk — declare the one fs function they use
// instead of pulling all of @types/node into the global scope.
declare module 'fs' {
    export function readFileSync(path: string, encoding: 'utf8'): string
}

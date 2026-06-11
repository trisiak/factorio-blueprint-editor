import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const fullReloadAlways = {
    name: 'full-reload',
    handleHotUpdate({ server }) {
        server.ws.send({ type: 'full-reload' })
        return []
    },
}

export default defineConfig(({ command, mode }) => {
    // NOTE: blueprint-URL imports hit a server-side CORS proxy at `/corsproxy`
    // (a Cloudflare Pages Function, `functions/corsproxy.js`). It doesn't run on
    // this fork's GitHub Pages deploy, and we no longer proxy dev to an external
    // host's proxy, so URL imports are inert here until the fork hosts its own —
    // see https://github.com/trisiak/factorio-blueprint-editor/issues/17. Paste /
    // raw `?source=<bpstring>` import still works.
    const proxy = {}
    if (mode !== 'production') {
        proxy['/data'] = {
            target: 'http://127.0.0.1:8081',
            rewrite: path => path.replace(/^\/data/, ''),
        }
    }
    // Sub-path deploys (e.g. GitHub Pages at /factorio-blueprint-editor/, or a
    // per-PR preview under /pr-preview/pr-N/) set PUBLIC_BASE. Defaults to '/'
    // so a root-path deploy and local dev are unchanged.
    let base = process.env.PUBLIC_BASE ?? '/'
    if (!base.endsWith('/')) base += '/'

    // Where the editor fetches data.json + the *.basis atlas from. Defaults to
    // this deploy's own `<base>data`; preview builds set VITE_DATA_URL to the
    // production deploy's atlas so they don't ship their own ~68 MB copy.
    const dataUrl = process.env.VITE_DATA_URL ?? `${base}data`

    // Preview builds reuse the shared atlas instead of copying ~68 MB into
    // dist; SKIP_DATA_COPY opts out of the static copy.
    const copyData = command === 'build' && process.env.SKIP_DATA_COPY !== 'true'

    const plugins = []
    if (command === 'build') {
        if (copyData) {
            plugins.push(
                viteStaticCopy({
                    targets: [{ src: '../exporter/data/output/*', dest: 'data' }],
                })
            )
        }
    } else {
        plugins.push(fullReloadAlways)
    }

    return {
        base,
        define: { __DATA_URL__: JSON.stringify(dataUrl) },
        build: { sourcemap: true },
        preview: { port: 8080 },
        server: {
            port: 8080,
            proxy,
        },
        plugins,
    }
})

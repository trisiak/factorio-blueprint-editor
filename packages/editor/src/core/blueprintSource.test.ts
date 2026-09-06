import { describe, expect, it } from 'vitest'
import { blueprintSourceRequest } from './blueprintSource'

const req = (href: string) => blueprintSourceRequest(new URL(href))

/**
 * The `?source=<url>` host table. Each entry is a site whose page URL is not the
 * blueprint string, so it has to be rewritten to a raw-content endpoint — the
 * kind of mapping that silently rots when a site changes shape, hence the table
 * test.
 */
describe('blueprintSourceRequest', () => {
    it('maps factoriobin page links to the blueprint.txt beside them', () => {
        // Upstream #272 (commit 12bbcef0), ported into this fork (#101).
        expect(req('https://factoriobin.com/post/vjLQ2n6y')).toEqual({
            url: 'https://factoriobin.com/post/vjLQ2n6y/blueprint.txt',
            format: 'text',
        })
    })

    it('maps the text-serving hosts to their raw endpoints', () => {
        expect(req('https://pastebin.com/abc123')).toEqual({
            url: 'https://pastebin.com/raw/abc123',
            format: 'text',
        })
        expect(req('https://hastebin.com/abc123')).toEqual({
            url: 'https://hastebin.com/raw/abc123',
            format: 'text',
        })
        expect(req('https://gitlab.com/user/project/-/snippets/1')).toEqual({
            url: 'https://gitlab.com/user/project/-/snippets/1/raw',
            format: 'text',
        })
        expect(req('https://docs.google.com/document/d/DOCID/edit')).toEqual({
            url: 'https://docs.google.com/document/d/DOCID/export?format=txt',
            format: 'text',
        })
    })

    it('maps the JSON-serving hosts, tagging how to unwrap them', () => {
        expect(req('https://gist.github.com/user/GISTID')).toEqual({
            url: 'https://api.github.com/gists/GISTID',
            format: 'gist',
        })
        expect(req('https://factorioprints.com/view/BPID')).toEqual({
            url: 'https://facorio-blueprints.firebaseio.com/blueprints/BPID.json',
            format: 'factorioprints',
        })
        expect(req('https://www.factorio.school/view/BPID')).toEqual({
            url: 'https://www.factorio.school/api/blueprint/BPID',
            format: 'factorio-school',
        })
    })

    it('passes an already-raw factorio.school API link straight through', () => {
        expect(req('https://www.factorio.school/api/blueprint/BPID')).toEqual({
            url: 'https://www.factorio.school/api/blueprint/BPID',
            format: 'text',
        })
    })

    it('ignores a www. prefix when matching the host', () => {
        expect(req('https://www.pastebin.com/abc123').url).toBe('https://pastebin.com/raw/abc123')
    })

    it('fetches an unknown host verbatim as text', () => {
        expect(req('https://example.com/some/raw/blueprint.txt')).toEqual({
            url: 'https://example.com/some/raw/blueprint.txt',
            format: 'text',
        })
    })
})

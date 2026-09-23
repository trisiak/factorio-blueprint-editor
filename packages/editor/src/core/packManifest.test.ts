import { describe, it, expect } from 'vitest'
import {
    PackManifestEntry,
    canonicalPackId,
    canonicalPacks,
    graphicsOptions,
    packMayHaveTextureTransforms,
} from './packManifest'

/**
 * Graphics variants (docs/slim-graphics.md): a slim pack is the same game data as
 * its base with smaller textures, so everything that scopes USER STATE keys on
 * the canonical id. These are the framework-free seams of that rule; the wiring
 * (library controller construction, the settings dropdown) is verified by running
 * the app.
 */
const MANIFEST: PackManifestEntry[] = [
    { id: 'vanilla-2.0', label: 'Vanilla 2.0', default: true },
    { id: 'space-age', label: 'Space Age (2.0)' },
    { id: 'vanilla-2.0-slim', variantOf: 'vanilla-2.0', graphics: 'slim' },
    { id: 'space-age-slim', label: 'Space Age (slim)', variantOf: 'space-age', graphics: 'slim' },
]

describe('canonicalPackId', () => {
    it('resolves a variant to its base and leaves base packs alone', () => {
        expect(canonicalPackId(MANIFEST, 'vanilla-2.0-slim')).toBe('vanilla-2.0')
        expect(canonicalPackId(MANIFEST, 'vanilla-2.0')).toBe('vanilla-2.0')
        expect(canonicalPackId(MANIFEST, 'space-age-slim')).toBe('space-age')
    })

    it('treats an unknown id (or no manifest at all) as its own canonical id', () => {
        expect(canonicalPackId(MANIFEST, 'some-modpack')).toBe('some-modpack')
        expect(canonicalPackId([], 'vanilla-2.0-slim')).toBe('vanilla-2.0-slim')
    })
})

describe('canonicalPacks', () => {
    it('collapses variants into their base, keeping the base label', () => {
        expect(canonicalPacks(MANIFEST)).toEqual([
            { id: 'vanilla-2.0', label: 'Vanilla 2.0' },
            { id: 'space-age', label: 'Space Age (2.0)' },
        ])
    })

    it('keeps a canonical id whose base entry is not published', () => {
        expect(canonicalPacks([{ id: 'x-slim', variantOf: 'x', graphics: 'slim' }])).toEqual([
            { id: 'x', label: 'x' },
        ])
    })

    it('lets a base entry that comes after its variant still win the label', () => {
        expect(
            canonicalPacks([
                { id: 'x-slim', variantOf: 'x', graphics: 'slim' },
                { id: 'x', label: 'Ex' },
            ])
        ).toEqual([{ id: 'x', label: 'Ex' }])
    })
})

describe('graphicsOptions', () => {
    it('lists the base tier first, then variants, labelled by tier', () => {
        expect(graphicsOptions(MANIFEST, 'vanilla-2.0')).toEqual([
            { id: 'vanilla-2.0', label: 'Full' },
            { id: 'vanilla-2.0-slim', label: 'Low quality' },
        ])
        expect(graphicsOptions(MANIFEST, 'space-age')).toEqual([
            { id: 'space-age', label: 'Full' },
            { id: 'space-age-slim', label: 'Low quality' },
        ])
    })

    it('lists just the base tier for a pack with no variants', () => {
        expect(graphicsOptions([{ id: 'a', label: 'A' }], 'a')).toEqual([
            { id: 'a', label: 'Full' },
        ])
    })

    it('still lists a variant whose base is absent, and none for an unknown id', () => {
        const orphan: PackManifestEntry[] = [{ id: 'x-slim', variantOf: 'x', graphics: 'slim' }]
        expect(graphicsOptions(orphan, 'x')).toEqual([{ id: 'x-slim', label: 'Low quality' }])
        expect(graphicsOptions(MANIFEST, 'some-modpack')).toEqual([])
    })
})

describe('packMayHaveTextureTransforms', () => {
    it('is false for a full pack — nothing to fetch, so no console 404 (#101 A13)', () => {
        expect(packMayHaveTextureTransforms(MANIFEST, 'vanilla-2.0')).toBe(false)
        expect(packMayHaveTextureTransforms(MANIFEST, 'space-age')).toBe(false)
    })

    it('is true for a graphics variant, which is the only kind that ships one', () => {
        expect(packMayHaveTextureTransforms(MANIFEST, 'vanilla-2.0-slim')).toBe(true)
        expect(packMayHaveTextureTransforms(MANIFEST, 'space-age-slim')).toBe(true)
    })

    it('falls back to probing when the manifest cannot decide', () => {
        // Unlisted pack (e.g. a local exporter dump) and no manifest at all:
        // keep the pre-gate behaviour rather than silently dropping transforms.
        expect(packMayHaveTextureTransforms(MANIFEST, 'some-modpack')).toBe(true)
        expect(packMayHaveTextureTransforms([], 'vanilla-2.0')).toBe(true)
    })
})

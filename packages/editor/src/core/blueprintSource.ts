// Where a `?source` URL's blueprint string actually lives, and in what shape.
//
// Framework-free and side-effect-free on purpose (`bpString.ts` owns the
// fetching): the host → request-URL mapping is the part that keeps growing a
// case per blueprint-sharing site, so it is the part worth unit-testing.

/** How to read the blueprint string out of the fetched response body. */
export type BlueprintSourceFormat =
    | 'text'
    /** GitHub gist JSON — take the first file's content. */
    | 'gist'
    /** factorioprints' firebase JSON — `blueprintString`. */
    | 'factorioprints'
    /** factorio.school's API JSON — `blueprintString.blueprintString`. */
    | 'factorio-school'

export interface BlueprintSourceRequest {
    /** Absolute URL to fetch (through the CORS proxy — see `bpString.ts`). */
    url: string
    format: BlueprintSourceFormat
}

/**
 * Map a user-supplied source URL to the raw-content URL to fetch.
 *
 * The host is matched on its first label with any `www.` stripped, so
 * `https://www.pastebin.com/xyz` and `https://pastebin.com/xyz` behave alike.
 * An unknown host is fetched verbatim and read as text — pasting a link to a
 * raw file has always worked and keeps working.
 */
export function blueprintSourceRequest(url: URL): BlueprintSourceRequest {
    const pathParts = url.pathname.slice(1).split('/')

    // TODO: add dropbox support https://www.dropbox.com/s/ID?raw=1
    switch (url.hostname.replace(/^www\./, '').split('.')[0]) {
        case 'pastebin':
            return { url: `https://pastebin.com/raw/${pathParts[0]}`, format: 'text' }
        case 'hastebin':
            return { url: `https://hastebin.com/raw/${pathParts[0]}`, format: 'text' }
        case 'gist':
            return { url: `https://api.github.com/gists/${pathParts[1]}`, format: 'gist' }
        case 'gitlab':
            return { url: `https://gitlab.com/${pathParts.join('/')}/raw`, format: 'text' }
        // Factoriobin serves the string as a plain file next to the page
        // (upstream #272 / commit 12bbcef0, ported into this fork).
        case 'factoriobin':
            return {
                url: `https://factoriobin.com/${pathParts.join('/')}/blueprint.txt`,
                format: 'text',
            }
        case 'factorioprints':
            return {
                url: `https://facorio-blueprints.firebaseio.com/blueprints/${pathParts[1]}.json`,
                format: 'factorioprints',
            }
        case 'factorio': // factorio.school
            // An API link is already the raw endpoint; a page link needs the id
            // lifted out of the path.
            if (pathParts[0] === 'api') return { url: url.href, format: 'text' }
            return {
                url: `https://www.factorio.school/api/blueprint/${pathParts[1]}`,
                format: 'factorio-school',
            }
        case 'docs':
            return {
                url: `https://docs.google.com/document/d/${pathParts[2]}/export?format=txt`,
                format: 'text',
            }
        default:
            return { url: url.href, format: 'text' }
    }
}

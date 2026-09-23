import { describe, expect, it } from 'vitest'
import { isFirefox } from './browser'

describe('isFirefox', () => {
    const UAS = {
        firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
        firefoxWindows:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
        firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:129.0) Gecko/129.0 Firefox/129.0',
        // iOS Firefox is a WebKit shell and reports FxiOS rather than Firefox/.
        firefoxIOS:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15',
        chrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    }

    it('matches Firefox on every platform', () => {
        expect(isFirefox(UAS.firefoxLinux)).toBe(true)
        expect(isFirefox(UAS.firefoxWindows)).toBe(true)
        expect(isFirefox(UAS.firefoxAndroid)).toBe(true)
        expect(isFirefox(UAS.firefoxIOS)).toBe(true)
    })

    it('does not match other browsers', () => {
        expect(isFirefox(UAS.chrome)).toBe(false)
        expect(isFirefox(UAS.safari)).toBe(false)
        expect(isFirefox(UAS.edge)).toBe(false)
    })

    it('reports false for an empty user agent', () => {
        expect(isFirefox('')).toBe(false)
    })
})

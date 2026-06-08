interface IToastsOptions {
    text: string
    type?: 'success' | 'info' | 'warning' | 'error'
    timeout?: number
    /**
     * Optional call-to-action button rendered inside the toast. Clicking it runs
     * `callback` and dismisses the toast (without triggering the toast's own
     * click-to-dismiss). Used for the "restore saved blueprint" prompt.
     */
    action?: { text: string; callback: () => void }
}

export function initToasts(): (options: IToastsOptions) => void {
    let autoincrement = 0
    const getNextID = (): string => {
        autoincrement += 1
        return `toast-${autoincrement}`
    }

    const container = document.createElement('div')
    container.className = 'toasts-container'
    document.body.appendChild(container)

    return (options: IToastsOptions) => {
        const toast = document.createElement('div')
        toast.id = getNextID()
        toast.className = 'toasts-toast'

        const text = document.createElement('span')
        text.className = 'toasts-text'
        text.innerHTML = options.text
        toast.appendChild(text)

        toast.classList.add(`toasts-${options.type || 'info'}`)

        const dismiss = (): void => {
            toast.classList.add('toasts-toast-fadeOut')
            toast.addEventListener(
                'transitionend',
                () => {
                    if (toast.parentNode === container) container.removeChild(toast)
                },
                { once: true }
            )
        }

        if (options.action) {
            const button = document.createElement('button')
            button.className = 'toasts-action'
            button.textContent = options.action.text
            button.addEventListener('click', e => {
                // Don't let the click also trigger the toast's dismiss-on-click.
                e.stopPropagation()
                options.action.callback()
                dismiss()
            })
            toast.appendChild(button)
        }

        toast.addEventListener(
            'animationend',
            () => {
                toast.style.maxHeight = `${toast.offsetHeight}px`
            },
            { once: true }
        )

        const promises = [
            new Promise(resolve => toast.addEventListener('click', resolve, { once: true })),
        ]

        if (options.timeout !== Infinity) {
            promises.push(new Promise(resolve => setTimeout(resolve, options.timeout || 5000)))
        }

        Promise.race(promises).then(dismiss)

        container.prepend(toast)
    }
}

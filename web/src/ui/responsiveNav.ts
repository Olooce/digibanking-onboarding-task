const COLLAPSED_KEY = 'dbk:nav-collapsed';
const PHONE = window.matchMedia('(max-width: 767px)');
const TABLET = window.matchMedia('(max-width: 1199px)');

type Layout = 'phone' | 'tablet' | 'desktop';

export interface ResponsiveNav {
    /** Closes the overlay/drawer (no-op on desktop); call on route change. */
    close(): void;
}

function readCollapsed(): boolean {
    try {
        return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
}

function writeCollapsed(value: boolean): void {
    try {
        localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
    } catch {
        // Preference is kept for this session only.
    }
}

/**
 * Desktop: full sidebar, toggle collapses it to an icon rail (remembered).
 * Tablet: icon rail, toggle expands it as an overlay.
 * Phone: off-canvas drawer, toggle opens it.
 */
export function bindResponsiveNav(
    app: HTMLElement,
    sidebar: HTMLElement,
    toggle: HTMLButtonElement,
    backdrop: HTMLElement,
): ResponsiveNav {
    let collapsed = readCollapsed();
    let open = false;
    const layout = (): Layout => (PHONE.matches ? 'phone' : TABLET.matches ? 'tablet' : 'desktop');

    function apply(): void {
        const mode = layout();
        if (mode === 'desktop') open = false;
        const rail = (mode === 'tablet' && !open) || (mode === 'desktop' && collapsed);
        app.dataset.layout = mode;
        app.toggleAttribute('data-rail', rail);
        app.toggleAttribute('data-nav-open', open);
        document.documentElement.classList.toggle('nav-locked', open && mode === 'phone');
        sidebar.inert = mode === 'phone' && !open;

        const expanded = mode === 'desktop' ? !collapsed : open;
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', mode === 'desktop'
            ? (collapsed ? 'Expand sidebar' : 'Collapse sidebar')
            : (open ? 'Close navigation' : 'Open navigation'));

        for (const link of sidebar.querySelectorAll<HTMLElement>('[data-label]')) {
            if (rail) link.title = link.dataset.label ?? '';
            else link.removeAttribute('title');
        }
    }

    function setOpen(value: boolean, {restoreFocus = true} = {}): void {
        if (open === value) return;
        open = value;
        apply();
        if (open) sidebar.querySelector<HTMLElement>('a[aria-current="page"], a.nav-item')?.focus();
        else if (restoreFocus) toggle.focus();
    }

    toggle.addEventListener('click', () => {
        if (layout() === 'desktop') {
            collapsed = !collapsed;
            writeCollapsed(collapsed);
            apply();
        } else {
            setOpen(!open);
        }
    });
    backdrop.addEventListener('click', () => setOpen(false));
    sidebar.addEventListener('click', (event) => {
        if (open && (event.target as Element).closest('a')) setOpen(false, {restoreFocus: false});
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && open) setOpen(false);
    });
    PHONE.addEventListener('change', apply);
    TABLET.addEventListener('change', apply);
    apply();

    return {
        close: () => setOpen(false, {restoreFocus: false}),
    };
}

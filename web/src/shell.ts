import {$, el, replace} from './dom.js';
import {bindResponsiveNav} from './ui/responsiveNav.js';

export type NavKey = 'batches' | 'members' | 'template';

export interface Crumb {
    label: string;
    href?: string;
}

export interface Shell {
    outlet: HTMLElement;

    setActive(key: NavKey | null): void;

    setBreadcrumb(items: Crumb[]): void;

    /** Replaces the last breadcrumb, for pages that learn their name after loading. */
    setPageLabel(label: string): void;

    setNavCount(key: NavKey, count: number | null): void;

    /** Closes the mobile/tablet navigation overlay. */
    closeNav(): void;
}

/** Binds behaviour to the shell markup in index.html. */
export function bindShell(): Shell {
    const app = $('.app');
    const sidebar = $('#sidebar');
    const outlet = $('#main');
    const crumbs = $('.breadcrumb ol');
    const links = new Map<string, HTMLAnchorElement>();
    for (const link of sidebar.querySelectorAll<HTMLAnchorElement>('a[data-nav]')) links.set(link.dataset.nav ?? '', link);

    $('[data-skip-link]').addEventListener('click', (event) => {
        event.preventDefault();
        outlet.focus();
    });

    const toggles = [...document.querySelectorAll<HTMLButtonElement>('.nav-toggle')];
    const nav = bindResponsiveNav(app, sidebar, toggles, $('.nav-backdrop'));

    return {
        outlet,
        setActive(key) {
            for (const [k, link] of links) {
                if (k === key) link.setAttribute('aria-current', 'page');
                else link.removeAttribute('aria-current');
            }
        },
        setPageLabel(label) {
            const last = crumbs.querySelector('li:last-child span');
            if (last) last.textContent = label;
            document.title = `${label} - DigiBank Onboarding`;
        },
        setBreadcrumb(items) {
            replace(crumbs, items.map((item, i) => {
                const last = i === items.length - 1;
                if (last || !item.href) return el('li', {}, el('span', {'aria-current': last ? 'page' : false}, item.label));
                return el('li', {}, el('a', {href: item.href}, item.label));
            }));
            const title = items[items.length - 1]?.label;
            document.title = title ? `${title} - DigiBank Onboarding` : 'DigiBank - Bulk Onboarding Console';
        },
        setNavCount(key, count) {
            const node = links.get(key)?.querySelector<HTMLElement>('.nav-item__count');
            if (!node) return;
            node.hidden = count === null;
            node.textContent = count === null ? '' : count.toLocaleString();
        },
        closeNav: () => nav.close(),
    };
}

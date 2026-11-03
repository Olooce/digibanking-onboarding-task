export interface RouteContext {
    params: Record<string, string>;
    query: URLSearchParams;
    outlet: HTMLElement;
    /** Aborted when the user navigates away; pass it to fetch() and close streams on it. */
    signal: AbortSignal;
}

export type PageResult = void | (() => void);
export type Page = (ctx: RouteContext) => PageResult | Promise<PageResult>;

export interface RouteDef {
    path: string;
    page: Page;
}

interface CompiledRoute extends RouteDef {
    regex: RegExp;
    keys: string[];
}

export interface Router {
    start(): void;
    navigate(path: string, options?: { replace?: boolean }): void;
    current(): { path: string; query: URLSearchParams };
    refresh(): void;
}

function compile(def: RouteDef): CompiledRoute {
    const keys: string[] = [];
    const pattern = def.path.replace(/\/:([a-zA-Z]+)/g, (_, key: string) => {
        keys.push(key);
        return '/([^/]+)';
    });
    return {...def, keys, regex: new RegExp(`^${pattern}/?$`)};
}

function parseHash(): { path: string; query: URLSearchParams } {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path = '/', search = ''] = hash.split('?');
    return {path: path.startsWith('/') ? path : `/${path}`, query: new URLSearchParams(search)};
}

export function createRouter(
    defs: RouteDef[],
    outlet: HTMLElement,
    options: { fallback: Page; onRoute?: (path: string) => void },
): Router {
    const routes = defs.map(compile);
    let controller: AbortController | null = null;
    let cleanup: (() => void) | null = null;

    async function render(): Promise<void> {
        controller?.abort();
        cleanup?.();
        cleanup = null;
        controller = new AbortController();
        const {signal} = controller;
        const {path, query} = parseHash();

        let page = options.fallback;
        const params: Record<string, string> = {};
        for (const route of routes) {
            const match = route.regex.exec(path);
            if (!match) continue;
            route.keys.forEach((key, i) => {
                params[key] = decodeURIComponent(match[i + 1] ?? '');
            });
            page = route.page;
            break;
        }

        outlet.replaceChildren();
        options.onRoute?.(path);
        try {
            const result = await page({params, query, outlet, signal});
            if (signal.aborted) result?.();
            else if (result) cleanup = result;
        } catch (error) {
            if (!signal.aborted) throw error;
        }
        if (!signal.aborted) {
            const heading = outlet.querySelector<HTMLElement>('h1');
            if (heading) {
                heading.tabIndex = -1;
                heading.focus({preventScroll: true});
            }
        }
    }

    return {
        start() {
            window.addEventListener('hashchange', () => void render());
            void render();
        },
        navigate(path, {replace = false} = {}) {
            const target = `#${path}`;
            if (location.hash === target) void render();
            else if (replace) {
                history.replaceState(null, '', target);
                void render();
            } else location.hash = path;
        },
        current: parseHash,
        refresh() {
            void render();
        },
    };
}

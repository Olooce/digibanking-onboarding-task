export interface Tabs {
    select(id: string): void;
    setCount(id: string, count: number | null): void;
}

/** Binds keyboard and selection behaviour to a role="tablist" of [data-tab] buttons. */
export function bindTabs(list: HTMLElement, onChange: (id: string) => void): Tabs {
    const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"][data-tab]')];

    function select(id: string): void {
        for (const tab of tabs) {
            const active = tab.dataset.tab === id;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        }
    }

    list.addEventListener('click', (event) => {
        const tab = (event.target as Element).closest<HTMLButtonElement>('[data-tab]');
        if (!tab || tab.getAttribute('aria-selected') === 'true') return;
        select(tab.dataset.tab ?? '');
        onChange(tab.dataset.tab ?? '');
    });

    list.addEventListener('keydown', (event) => {
        const index = tabs.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        const steps: Record<string, number> = {ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1};
        const nextIndex = steps[event.key];
        if (nextIndex === undefined) return;
        event.preventDefault();
        const next = tabs[(nextIndex + tabs.length) % tabs.length];
        next?.focus();
        next?.click();
    });

    return {
        select,
        setCount(id, count) {
            const node = tabs.find((tab) => tab.dataset.tab === id)?.querySelector<HTMLElement>('.tab__count');
            if (!node) return;
            node.hidden = count === null;
            node.textContent = count === null ? '' : count.toLocaleString();
        },
    };
}

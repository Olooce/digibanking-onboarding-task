export type Child = Node | string | number | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined | EventListener | Record<string, string>;
export type Attrs = Record<string, AttrValue>;

/** Required element lookup; a missing element is a markup bug, so fail loudly. */
export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing element: ${selector}`);
    return node;
}

/** Clones a <template> from index.html. */
export function fromTemplate(id: string): DocumentFragment {
    const tpl = document.getElementById(id);
    if (!(tpl instanceof HTMLTemplateElement)) throw new Error(`Missing <template id="${id}">`);
    return tpl.content.cloneNode(true) as DocumentFragment;
}

/** Finds a [data-slot] placeholder inside a cloned template. */
export function slot<T extends Element = HTMLElement>(root: ParentNode, name: string): T {
    return $<T>(`[data-slot="${name}"]`, root);
}

/** Creates an element for data-driven markup. Strings are inserted as text, never parsed as HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Attrs = {},
    children: Child | Child[] = [],
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') node.className = String(value);
        else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, String(value));
    }
    append(node, children);
    return node;
}

export function append(parent: Node, children: Child | Child[]): void {
    for (const child of Array.isArray(children) ? children : [children]) {
        if (child === null || child === undefined || child === false) continue;
        parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

export function replace(parent: Element, children: Child | Child[]): void {
    parent.replaceChildren();
    append(parent, children);
}

/** True when a keyboard shortcut should be ignored because the user is typing. */
export function isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

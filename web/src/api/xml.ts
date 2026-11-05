/** Parses an XML response body; returns null when it is not well-formed. */
export function parseXml(text: string): Element | null {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    return doc.documentElement;
}

export function child(parent: Element, name: string): Element | null {
    for (const node of parent.children) if (node.tagName === name) return node;
    return null;
}

/** Text of a direct child; absent and empty elements both read as ''. */
export function text(parent: Element, name: string): string {
    return child(parent, name)?.textContent?.trim() ?? '';
}

export function int(parent: Element, name: string): number {
    const value = Number(text(parent, name));
    return Number.isFinite(value) ? value : 0;
}

/** The <item> children of a list element such as <data>. */
export function items(parent: Element, name: string): Element[] {
    const list = child(parent, name);
    return list ? [...list.children].filter((node) => node.tagName === 'item') : [];
}

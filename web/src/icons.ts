const SVG_NS = 'http://www.w3.org/2000/svg';

/** Symbol ids available in the sprite inside index.html (#i-<name>). */
export type IconName =
    | 'search' | 'filter' | 'sort' | 'columns' | 'x' | 'plus' | 'trash'
    | 'first' | 'prev' | 'next' | 'last' | 'up' | 'down' | 'kebab'
    | 'download' | 'upload' | 'check' | 'checkCircle' | 'xCircle' | 'alert' | 'info'
    | 'refresh' | 'wifiOff' | 'layers' | 'users' | 'sheet' | 'eye' | 'clock'
    | 'copy' | 'play' | 'pause' | 'arrowLeft' | 'help' | 'external' | 'user' | 'shieldCheck' | 'menu';

/** Reference to a sprite icon, for markup that is created from data at runtime. */
export function icon(name: IconName, size: 'sm' | 'md' | 'lg' = 'md'): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', size === 'md' ? 'icon' : `icon icon--${size}`);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
}

export function setIcon(use: SVGUseElement, name: IconName): void {
    use.setAttribute('href', `#i-${name}`);
}

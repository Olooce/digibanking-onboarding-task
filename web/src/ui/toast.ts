import {$, fromTemplate, slot} from '../dom.js';
import {type IconName, setIcon} from '../icons.js';

export type Tone = 'info' | 'success' | 'warning' | 'danger';

const TONE_ICON: Record<Tone, IconName> = {info: 'info', success: 'checkCircle', warning: 'alert', danger: 'xCircle'};

export interface ToastOptions {
    tone?: Tone;
    title: string;
    message?: string;
    /** Milliseconds before auto-dismiss; errors stay until dismissed. */
    timeout?: number;
}

export function toast({tone = 'info', title, message, timeout}: ToastOptions): () => void {
    const fragment = fromTemplate('tpl-toast');
    const node = $('.toast', fragment);
    node.classList.add(`alert--${tone}`);
    node.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    setIcon(slot<SVGUseElement>(node, 'icon'), TONE_ICON[tone]);
    slot(node, 'title').textContent = title;
    const body = slot(node, 'message');
    if (message) body.textContent = message;
    else body.remove();

    const dismiss = () => node.remove();
    $('[data-action="dismiss"]', node).addEventListener('click', dismiss);
    $('.toasts').append(node);
    const ms = timeout ?? (tone === 'danger' ? 0 : 6000);
    if (ms > 0) setTimeout(dismiss, ms);
    return dismiss;
}

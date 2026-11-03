import {fromTemplate, slot} from '../dom.js';
import type {Page} from '../router.js';

/** Temporary page used until the real view for a route is built. */
export function pendingPage(title: string, subtitle: string): Page {
    return ({outlet}) => {
        const view = fromTemplate('tpl-pending');
        slot(view, 'title').textContent = title;
        slot(view, 'subtitle').textContent = subtitle;
        outlet.append(view);
    };
}

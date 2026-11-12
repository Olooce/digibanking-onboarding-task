import {downloadTemplate} from '../api/files.js';
import {fromTemplate, slot} from '../dom.js';
import type {Page} from '../router.js';
import {bindDownloadButton} from '../ui/downloadButton.js';

export const templatePage: Page = ({outlet}) => {
    const view = fromTemplate('tpl-template');
    bindDownloadButton(slot<HTMLButtonElement>(view, 'download'), 'Template', downloadTemplate);
    outlet.append(view);
};

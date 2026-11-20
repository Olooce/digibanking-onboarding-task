import {describeError, type ProgressListener} from '../api/client.js';
import {el} from '../dom.js';
import {setProgress} from './progress.js';
import {toast} from './toast.js';

let buttonCount = 0;

/**
 * Runs a download when the button is clicked. While the file arrives a progress bar fills along the
 * button's bottom edge (it slides back and forth when the server does not send the size). Clicks during a
 * download are ignored, and failures are reported in a toast.
 */
export function bindDownloadButton(
    button: HTMLButtonElement,
    what: string,
    download: (onProgress: ProgressListener) => Promise<void>,
): void {
    // The bar is laid over the button from a wrapper, not put inside it, so it never changes the button's name.
    const wrapper = el('span', {class: 'download'});
    button.replaceWith(wrapper);
    wrapper.append(button);
    if (!button.id) {
        buttonCount += 1;
        button.id = `download-${buttonCount}`;
    }
    let busy = false;

    button.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        // Named by the button, so a screen reader hears for example "Export CSV, 40%".
        const bar = el('progress', {class: 'progress download__bar', 'aria-labelledby': button.id});
        wrapper.append(bar);
        button.setAttribute('data-busy', '');
        try {
            await download((received, total) => setProgress(bar, total === null ? null : received, total ?? 1));
        } catch (error) {
            const {title, detail} = describeError(error);
            toast({tone: 'danger', title: `${what} not downloaded. ${title}`, message: detail});
        } finally {
            busy = false;
            bar.remove();
            button.removeAttribute('data-busy');
        }
    });
}

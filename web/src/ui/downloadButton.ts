import {describeError} from '../api/client.js';
import {toast} from './toast.js';

/** Runs a download when the button is clicked, showing it as busy and reporting failures in a toast. */
export function bindDownloadButton(button: HTMLButtonElement, what: string, download: () => Promise<void>): void {
    button.addEventListener('click', async () => {
        if (button.getAttribute('aria-busy') === 'true') return;
        button.setAttribute('aria-busy', 'true');
        try {
            await download();
        } catch (error) {
            const {title, detail} = describeError(error);
            toast({tone: 'danger', title: `${what} not downloaded. ${title}`, message: detail});
        } finally {
            button.removeAttribute('aria-busy');
        }
    });
}

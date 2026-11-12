import {isNetworkError} from '../api/client.js';

const RETRY_DELAY_MS = 5000;

/** Resolves when the browser reports it is back online, or after a short delay, whichever comes first. */
function waitForConnection(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            window.removeEventListener('online', done);
            signal.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, RETRY_DELAY_MS);
        window.addEventListener('online', done);
        signal.addEventListener('abort', done);
    });
}

/**
 * Runs a request and, if it fails because the network is down, waits and runs it again.
 * A lost connection pauses the upload instead of failing it; any other error is thrown.
 * `<T>` lets the caller get back whatever its request returns.
 */
export async function retryWhileOffline<T>(request: () => Promise<T>, onOffline: () => void, signal: AbortSignal): Promise<T> {
    while (true) {
        try {
            return await request();
        } catch (error) {
            if (!isNetworkError(error) || signal.aborted) throw error;
            onOffline();
            await waitForConnection(signal);
            signal.throwIfAborted();
        }
    }
}

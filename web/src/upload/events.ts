import {child, parseXml} from '../api/xml.js';
import {apiUrl} from '../config.js';

const EVENT_TYPES = [
    'upload_created', 'chunk_received', 'file_received', 'processing_started', 'row_processed',
    'validation_completed', 'failed', 'commit_started', 'row_committed', 'commit_completed', 'stream_end',
];
const RECONNECT_DELAY_MS = 3000;

export interface UploadEventHandlers {
    /** Events can arrive again after a reconnect, so handling the same event twice must be harmless. */
    onEvent(type: string, payload: Element): void;

    onConnection(state: 'live' | 'reconnecting'): void;
}

/**
 * Follows the upload's Server-Sent Events. After a dropped connection the browser reconnects by itself
 * and sends Last-Event-ID, so only missed events are replayed. If the stream is closed instead, a new
 * one is opened, which replays from the start. The server finishes with stream_end; the source is then
 * closed so the browser does not reconnect.
 */
export function watchUploadEvents(uploadId: string, handlers: UploadEventHandlers, signal: AbortSignal): void {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let ended = false;

    function stop(): void {
        clearTimeout(reconnectTimer);
        source?.close();
    }

    function open(): void {
        const current = new EventSource(apiUrl(`/uploads/${encodeURIComponent(uploadId)}/events`));
        source = current;
        current.addEventListener('open', () => handlers.onConnection('live'));
        current.addEventListener('error', () => {
            if (ended || signal.aborted) return;
            handlers.onConnection('reconnecting');
            if (current.readyState === EventSource.CLOSED) reconnectTimer = setTimeout(open, RECONNECT_DELAY_MS);
        });
        for (const type of EVENT_TYPES) {
            current.addEventListener(type, (event) => {
                if (type === 'stream_end') {
                    ended = true;
                    stop();
                }
                const root = parseXml((event as MessageEvent).data);
                if (root) handlers.onEvent(type, child(root, 'payload') ?? root);
            });
        }
    }

    signal.addEventListener('abort', stop, {once: true});
    open();
}

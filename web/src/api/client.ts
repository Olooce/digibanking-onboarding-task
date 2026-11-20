import {apiUrl} from '../config.js';
import {child, parseXml, text} from './xml.js';

export class ApiError extends Error {
    constructor(
        message: string,
        /** HTTP status; 0 when no response was received. */
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export interface ErrorSummary {
    title: string;
    detail: string;
}

export function describeError(error: unknown): ErrorSummary {
    if (!(error instanceof ApiError)) return {
        title: 'Something went wrong',
        detail: 'An unexpected error occurred. Try again.'
    };
    if (error.status === 0) return {
        title: 'Cannot reach the onboarding service',
        detail: 'Check the network connection and that the API is running, then try again.'
    };
    if (error.status === 404) return {title: 'Not found', detail: error.message};
    if (error.status === 409) return {title: 'This action is not available right now', detail: error.message};
    if (error.status >= 500) return {title: 'The onboarding service had a problem', detail: error.message};
    return {title: 'The request was not accepted', detail: error.message};
}

export function isNetworkError(error: unknown): boolean {
    return error instanceof ApiError && error.status === 0;
}

let connectionListener: ((reachable: boolean) => void) | null = null;

/** Called after every request with whether the server answered, so the header can show it. */
export function onServerConnection(listener: (reachable: boolean) => void): void {
    connectionListener = listener;
}

/** Asks the API's health endpoint whether the server is up; throws ApiError when it cannot be reached. */
export async function checkServer(): Promise<void> {
    await requestXml('/health');
}

async function send(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
        response = await fetch(apiUrl(path), init);
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        connectionListener?.(false);
        throw new ApiError('No response from the service.', 0, 'NETWORK');
    }
    connectionListener?.(true);
    if (!response.ok) {
        const failure = child(parseXml(await response.text()) ?? document.createElement('none'), 'error');
        if (failure) throw new ApiError(text(failure, 'message'), response.status, text(failure, 'code'));
        throw new ApiError(`The service responded with HTTP ${response.status}.`, response.status, 'HTTP');
    }
    return response;
}

/** Sends a request and returns the root of the XML response, throwing ApiError on failure. */
export async function requestXml(path: string, init: RequestInit = {}): Promise<Element> {
    const response = await send(path, init);
    const root = parseXml(await response.text());
    if (!root) throw new ApiError('The service sent a response that could not be read.', response.status, 'BAD_XML');
    const failure = child(root, 'error');
    if (failure) throw new ApiError(text(failure, 'message'), response.status, text(failure, 'code'));
    return root;
}

/** Told how many bytes of a download have arrived; `total` is null when the server does not send the size. */
export type ProgressListener = (received: number, total: number | null) => void;

/** Reads the body piece by piece so `onProgress` can follow it, then joins the pieces into one Blob. */
async function readBody(response: Response, onProgress: ProgressListener): Promise<Blob> {
    const type = response.headers.get('Content-Type') ?? '';
    // The total is the Content-Length header: the full size in bytes. Without it the size is unknown (null).
    const total = Number(response.headers.get('Content-Length')) || null;
    if (!response.body) return response.blob();
    const reader = response.body.getReader();
    const pieces: BlobPart[] = [];
    let received = 0;
    onProgress(received, total);
    while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        pieces.push(value);
        received += value.byteLength;
        onProgress(received, total);
    }
    return new Blob(pieces, {type});
}

/** Fetches a binary download and the file name the server suggests. */
export async function requestBlob(path: string, onProgress?: ProgressListener): Promise<{
    blob: Blob;
    fileName: string | null
}> {
    const response = await send(path, {});
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const blob = onProgress ? await readBody(response, onProgress) : await response.blob();
    return {blob, fileName: match?.[1] ? decodeURIComponent(match[1]) : null};
}

export function withQuery(path: string, query: URLSearchParams): string {
    const search = query.toString();
    return search ? `${path}?${search}` : path;
}

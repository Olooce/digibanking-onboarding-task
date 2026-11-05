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
    if (!(error instanceof ApiError)) return {title: 'Something went wrong', detail: 'An unexpected error occurred. Try again.'};
    if (error.status === 0) return {title: 'Cannot reach the onboarding service', detail: 'Check the network connection and that the API is running, then try again.'};
    if (error.status === 404) return {title: 'Not found', detail: error.message};
    if (error.status === 409) return {title: 'This action is not available right now', detail: error.message};
    if (error.status >= 500) return {title: 'The onboarding service had a problem', detail: error.message};
    return {title: 'The request was not accepted', detail: error.message};
}

/** Sends a request and returns the root of the XML response, throwing ApiError on failure. */
export async function requestXml(path: string, init: RequestInit = {}): Promise<Element> {
    let response: Response;
    try {
        response = await fetch(apiUrl(path), init);
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError('No response from the service.', 0, 'NETWORK');
    }
    const root = parseXml(await response.text());
    const failure = root && child(root, 'error');
    if (failure) throw new ApiError(text(failure, 'message'), response.status, text(failure, 'code'));
    if (!response.ok) throw new ApiError(`The service responded with HTTP ${response.status}.`, response.status, 'HTTP');
    if (!root) throw new ApiError('The service sent a response that could not be read.', response.status, 'BAD_XML');
    return root;
}

export function withQuery(path: string, query: URLSearchParams): string {
    const search = query.toString();
    return search ? `${path}?${search}` : path;
}

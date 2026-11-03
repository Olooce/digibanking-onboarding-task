import {API_BASE_URL} from './env.generated.js';

/** API base address, fixed at build time from web/.env (API_BASE_URL). */
export const API_BASE: string = API_BASE_URL;

/** Joins an endpoint path such as "/uploads" onto the API base. */
export function apiUrl(path: string): string {
    return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

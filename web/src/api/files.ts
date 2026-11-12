import {requestBlob, withQuery} from './client.js';

function saveBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), {href: url, download: fileName});
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Downloads a file from the API. The API does not expose Content-Disposition to browsers on these
 * responses, so the caller's name is normally used; a readable server name would take priority.
 */
async function downloadFile(path: string, fallbackName: string): Promise<void> {
    const {blob, fileName} = await requestBlob(path);
    saveBlob(blob, fileName ?? fallbackName);
}

export function downloadTemplate(): Promise<void> {
    return downloadFile('/onboarding/template', 'onboarding-template.xlsx');
}

/** All invalid and duplicate rows of a batch, as a workbook. */
export function downloadRejectedRows(uploadId: string, fileBase: string): Promise<void> {
    return downloadFile(`/uploads/${encodeURIComponent(uploadId)}/invalid.xlsx`, `${fileBase}-rejected-rows.xlsx`);
}

/** The batch's records matching `query` ($filter, $orderby and status), as CSV or XLSX. */
export function exportRecords(uploadId: string, query: URLSearchParams, format: 'csv' | 'xlsx', fileBase: string): Promise<void> {
    const params = new URLSearchParams(query);
    params.set('format', format);
    const status = params.get('status') ?? 'records';
    return downloadFile(withQuery(`/uploads/${encodeURIComponent(uploadId)}/records/export`, params), `${fileBase}-${status}.${format}`);
}

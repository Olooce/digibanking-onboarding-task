import {requestXml, withQuery} from './client.js';
import {child, int, items, text} from './xml.js';

export type UploadStatus =
    | 'created' | 'uploading' | 'uploaded' | 'validating' | 'validated'
    | 'validated_with_errors' | 'committing' | 'committed' | 'committed_with_errors' | 'failed';

export interface Upload {
    id: string;
    batchName: string;
    description: string;
    fileName: string;
    status: UploadStatus;
    totalRows: number;
    processedRows: number;
    validRows: number;
    /** Counts invalid and duplicate rows together. */
    invalidRows: number;
    onboardedRows: number;
    createdAt: string;
    updatedAt: string;
}

export interface ListPage<T> {
    rows: T[];
    total: number;
}

function toUpload(node: Element): Upload {
    return {
        id: text(node, 'id'),
        batchName: text(node, 'batch_name'),
        description: text(node, 'description'),
        fileName: text(node, 'file_name'),
        status: text(node, 'status') as UploadStatus,
        totalRows: int(node, 'total_rows'),
        processedRows: int(node, 'processed_rows'),
        validRows: int(node, 'valid_rows'),
        invalidRows: int(node, 'invalid_rows'),
        onboardedRows: int(node, 'onboarded_rows'),
        createdAt: text(node, 'created_at'),
        updatedAt: text(node, 'updated_at'),
    };
}

export async function listUploads(query: URLSearchParams, signal?: AbortSignal): Promise<ListPage<Upload>> {
    const root = await requestXml(withQuery('/uploads', query), {signal});
    const pagination = child(root, 'pagination');
    return {
        rows: items(root, 'data').map(toUpload),
        total: pagination ? int(pagination, 'total') : 0,
    };
}

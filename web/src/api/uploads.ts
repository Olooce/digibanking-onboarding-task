import {requestXml, withQuery} from './client.js';
import {child, int, items, text, xmlDocument} from './xml.js';

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

export interface UploadDetail extends Upload {
    fileSize: number;
    fileSha256: string;
    chunkSize: number;
    chunkCount: number;
    uploadedChunks: number[];
}

export interface UploadMeta {
    batchName: string;
    description: string;
    fileName: string;
    fileSize: number;
    fileSha256: string;
}

function toUploadDetail(node: Element): UploadDetail {
    return {
        ...toUpload(node),
        fileSize: int(node, 'file_size'),
        fileSha256: text(node, 'file_sha256'),
        chunkSize: int(node, 'chunk_size'),
        chunkCount: int(node, 'chunk_count'),
        uploadedChunks: items(node, 'uploaded_chunks').map((item) => Number(item.textContent)),
    };
}

function uploadOf(root: Element): UploadDetail {
    const node = child(root, 'upload');
    if (!node) throw new Error('The response did not include the upload.');
    return toUploadDetail(node);
}

export async function getUpload(id: string, signal?: AbortSignal): Promise<UploadDetail> {
    return uploadOf(await requestXml(`/uploads/${encodeURIComponent(id)}`, {signal}));
}

/** Creates the batch, or returns the same one when retried with the same idempotency key. */
export async function createUpload(meta: UploadMeta, idempotencyKey: string, signal?: AbortSignal): Promise<UploadDetail> {
    const root = await requestXml('/uploads', {
        method: 'POST',
        signal,
        headers: {'Content-Type': 'application/xml', 'Idempotency-Key': idempotencyKey},
        body: xmlDocument('upload_request', {
            batch_name: meta.batchName,
            description: meta.description,
            file_name: meta.fileName,
            file_size: meta.fileSize,
            file_sha256: meta.fileSha256,
        }),
    });
    return uploadOf(root);
}

/** Safe to repeat: the server accepts a chunk again when its digest matches. */
export async function putChunk(id: string, index: number, bytes: Blob, sha256: string, signal?: AbortSignal): Promise<void> {
    await requestXml(`/uploads/${encodeURIComponent(id)}/chunks/${index}`, {
        method: 'PUT',
        signal,
        headers: {'Content-Type': 'application/octet-stream', 'Content-SHA256': sha256},
        body: bytes,
    });
}

/** Verifies the assembled file and starts validation. Validation never onboards members. */
export async function completeUpload(id: string, signal?: AbortSignal): Promise<UploadDetail> {
    return uploadOf(await requestXml(`/uploads/${encodeURIComponent(id)}/complete`, {method: 'POST', signal}));
}

export type RecordStatus = 'pending' | 'checking' | 'valid' | 'onboarded' | 'invalid' | 'duplicate';

/** One workbook row and the result of validating it. */
export interface UploadRecord {
    id: string;
    rowNumber: number;
    status: RecordStatus;
    reason: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    email: string;
    branch: string;
    accountType: string;
    memberNumber: string;
    phoneNumber: string;
    idNumber: string;
    /** Set once the row has been committed and the member onboarded. */
    memberId: string;
}

export interface RecordPage extends ListPage<UploadRecord> {
    /** Rows per status across the whole batch, whatever the filter. */
    statusCounts: Record<string, number>;
}

function toRecord(node: Element): UploadRecord {
    return {
        id: text(node, 'id'),
        rowNumber: int(node, 'row_number'),
        status: text(node, 'status') as RecordStatus,
        reason: text(node, 'reason'),
        firstName: text(node, 'first_name'),
        lastName: text(node, 'last_name'),
        dateOfBirth: text(node, 'date_of_birth'),
        email: text(node, 'email'),
        branch: text(node, 'branch'),
        accountType: text(node, 'account_type'),
        memberNumber: text(node, 'member_number'),
        phoneNumber: text(node, 'phone_number'),
        idNumber: text(node, 'id_number'),
        memberId: text(node, 'member_id'),
    };
}

export async function listRecords(uploadId: string, query: URLSearchParams, signal?: AbortSignal): Promise<RecordPage> {
    const root = await requestXml(withQuery(`/uploads/${encodeURIComponent(uploadId)}/records`, query), {signal});
    const pagination = child(root, 'pagination');
    const statusCounts: Record<string, number> = {};
    for (const item of items(root, 'status_counts')) statusCounts[text(item, 'status')] = int(item, 'count');
    return {
        rows: items(root, 'data').map(toRecord),
        total: pagination ? int(pagination, 'total') : 0,
        statusCounts,
    };
}

export interface CommitResult {
    committedRows: number;
    /** Valid rows that could not be committed, for example because the member was onboarded meanwhile. */
    conflictRows: number;
    alreadyCommitted: boolean;
    upload: UploadDetail;
}

/** Onboards the valid rows. Invalid and duplicate rows stay in the batch. */
export async function commitUpload(id: string, signal?: AbortSignal): Promise<CommitResult> {
    const root = await requestXml(`/uploads/${encodeURIComponent(id)}/commit`, {
        method: 'POST',
        signal,
        headers: {'Content-Type': 'application/xml'},
        body: xmlDocument('commit_request', {review_confirmed: true}),
    });
    return {
        committedRows: int(root, 'committed_rows'),
        conflictRows: int(root, 'conflict_rows'),
        alreadyCommitted: text(root, 'already_committed') === 'true',
        upload: uploadOf(root),
    };
}

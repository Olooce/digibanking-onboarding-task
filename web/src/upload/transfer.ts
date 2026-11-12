import {putChunk, type UploadDetail} from '../api/uploads.js';
import {retryWhileOffline} from './retry.js';
import {sha256Hex} from './sha256.js';

/** Sends the parts the server does not have yet. Resending a part is safe, so a lost response just means sending it again. */
export async function sendMissingChunks(
    file: File,
    upload: UploadDetail,
    onProgress: (receivedParts: number) => void,
    onOffline: () => void,
    signal: AbortSignal,
): Promise<void> {
    const received = new Set(upload.uploadedChunks);
    onProgress(received.size);

    for (let index = 0; index < upload.chunkCount; index += 1) {
        if (received.has(index)) continue;
        const start = index * upload.chunkSize;
        const part = file.slice(start, start + upload.chunkSize);
        const digest = await sha256Hex(part);
        await retryWhileOffline(() => putChunk(upload.id, index, part, digest, signal), onOffline, signal);
        received.add(index);
        onProgress(received.size);
    }
}

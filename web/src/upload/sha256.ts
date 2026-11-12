/** Hex SHA-256 of a file or part of one. Needs a secure context (https or localhost). */
export async function sha256Hex(data: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
});

/** Formats an API timestamp in the viewer's locale; blank values read as a dash. */
export function formatDateTime(iso: string): string {
    const date = new Date(iso);
    return iso && !Number.isNaN(date.getTime()) ? DATE_TIME.format(date) : '-';
}

export function formatCount(value: number): string {
    return value.toLocaleString();
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A file-name-safe version of a label, for example "Riverside Branch - October" becomes "riverside-branch-october". */
export function fileSlug(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'batch';
}

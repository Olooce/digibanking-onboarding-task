const DATE_TIME = new Intl.DateTimeFormat(undefined, {day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});

/** Formats an API timestamp in the viewer's locale; blank values read as a dash. */
export function formatDateTime(iso: string): string {
    const date = new Date(iso);
    return iso && !Number.isNaN(date.getTime()) ? DATE_TIME.format(date) : '—';
}

export function formatCount(value: number): string {
    return value.toLocaleString();
}

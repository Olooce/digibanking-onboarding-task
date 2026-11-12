import type {RecordStatus, UploadStatus} from './api/uploads.js';
import {el} from './dom.js';

type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'success-solid' | 'danger';

interface StatusInfo {
    label: string;
    tone: Tone;
    /** Shows a pulsing dot while work is still happening. */
    live?: boolean;
}

export const UPLOAD_STATUS: Record<UploadStatus, StatusInfo & { next: string }> = {
    created: {label: 'Created', tone: 'neutral', next: 'Upload the workbook'},
    uploading: {label: 'Uploading', tone: 'info', live: true, next: 'Finish or resume the upload'},
    uploaded: {label: 'Uploaded', tone: 'info', next: 'Start validation'},
    validating: {label: 'Validating', tone: 'info', live: true, next: 'Wait for validation'},
    validated: {label: 'Validated', tone: 'warning', next: 'Review and commit'},
    validated_with_errors: {label: 'Validated with errors', tone: 'warning', next: 'Review and commit'},
    committing: {label: 'Committing', tone: 'info', live: true, next: 'Wait for the commit'},
    committed: {label: 'Committed', tone: 'success-solid', next: 'Complete'},
    committed_with_errors: {label: 'Committed with errors', tone: 'success', next: 'Download rejected rows'},
    failed: {label: 'Failed', tone: 'danger', next: 'Open to see what failed'},
};

export const RECORD_STATUS: Record<RecordStatus, StatusInfo> = {
    pending: {label: 'Pending', tone: 'neutral'},
    checking: {label: 'Checking', tone: 'info', live: true},
    valid: {label: 'Valid', tone: 'success'},
    invalid: {label: 'Invalid', tone: 'danger'},
    duplicate: {label: 'Duplicate', tone: 'warning'},
    onboarded: {label: 'Onboarded', tone: 'success-solid'},
};

export function statusBadge(info: StatusInfo | undefined, fallback: string): HTMLElement {
    if (!info) return el('span', {class: 'badge'}, fallback);
    return el('span', {class: `badge badge--${info.tone}${info.live ? ' badge--live' : ''}`}, info.label);
}

/** Choices for an enum column's filter. */
export function statusOptions(statuses: Record<string, StatusInfo>): { value: string; label: string }[] {
    return Object.entries(statuses).map(([value, info]) => ({value, label: info.label}));
}

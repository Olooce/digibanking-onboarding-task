import {describeError} from '../api/client.js';
import {anyOf, literal, toODataParams, type ListSchema} from '../api/odata.js';
import {listUploads, type Upload, type UploadStatus} from '../api/uploads.js';
import {$, el, fromTemplate, slot} from '../dom.js';
import {formatCount, formatDateTime} from '../format.js';
import type {Page} from '../router.js';
import {patchHashQuery} from '../router.js';
import type {Shell} from '../shell.js';
import {createDataTable, type ColumnConfig, type Query} from '../ui/dataTable.js';
import {bindTabs} from '../ui/tabs.js';

type BadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'success-solid' | 'danger';

const STATUS: Record<UploadStatus, { label: string; tone: BadgeTone; live?: boolean; next: string }> = {
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

function statusScope(statuses: UploadStatus[]): string {
    return anyOf(statuses.map((status) => `status eq ${literal(status)}`));
}

const SCOPES: Record<string, string | null> = {
    all: null,
    review: statusScope(['validated', 'validated_with_errors']),
    progress: statusScope(['created', 'uploading', 'uploaded', 'validating', 'committing']),
    committed: statusScope(['committed', 'committed_with_errors']),
    failed: statusScope(['failed']),
};

function statusBadge(status: UploadStatus): HTMLElement {
    const meta = STATUS[status];
    return el('span', {class: `badge badge--${meta.tone}${meta.live ? ' badge--live' : ''}`}, meta.label);
}

/** Zero is shown as a muted dash so the non-zero counts stand out. */
function count(value: number, tone?: 'success' | 'danger'): HTMLElement | string {
    if (value === 0) return el('span', {class: 'dt-null', 'aria-label': 'none'}, '–');
    return tone ? el('span', {class: `text-${tone}`}, formatCount(value)) : formatCount(value);
}

const ORDERED = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'];
const NUMERIC = {type: 'number' as const, operators: ORDERED};
const TEXT = {operators: ['contains', 'notContains', 'startsWith', 'endsWith', 'eq', 'neq']};
const DAY = {type: 'date' as const, operators: ORDERED};

const COLUMNS: ColumnConfig<Upload>[] = [
    {
        key: 'batch_name',
        label: 'Batch',
        ...TEXT,
        hideable: false,
        maxWidth: '22rem',
        accessor: (row) => row.batchName,
        render: (row) => el('a', {class: 'dt-link', href: `#/batches/${encodeURIComponent(row.id)}`}, row.batchName),
    },
    {
        key: 'status',
        label: 'Status',
        type: 'enum',
        operators: ['eq', 'neq'],
        options: Object.entries(STATUS).map(([value, meta]) => ({value, label: meta.label})),
        accessor: (row) => row.status,
        render: (row) => statusBadge(row.status),
    },
    {key: 'total_rows', label: 'Rows', ...NUMERIC, accessor: (row) => row.totalRows, render: (row) => count(row.totalRows)},
    {key: 'valid_rows', label: 'Valid', ...NUMERIC, accessor: (row) => row.validRows, render: (row) => count(row.validRows, 'success')},
    {key: 'invalid_rows', label: 'Rejected', ...NUMERIC, accessor: (row) => row.invalidRows, render: (row) => count(row.invalidRows, 'danger')},
    {key: 'onboarded_rows', label: 'Onboarded', ...NUMERIC, accessor: (row) => row.onboardedRows, render: (row) => count(row.onboardedRows)},
    {
        key: 'next',
        label: 'Next step',
        sortable: false,
        filterable: false,
        render: (row) => row.status === 'validating' ? `Validating ${row.processedRows} of ${row.totalRows}` : STATUS[row.status].next,
    },
    {key: 'file_name', label: 'File', ...TEXT, hidden: true, maxWidth: '16rem', accessor: (row) => row.fileName},
    {key: 'description', label: 'Description', ...TEXT, hidden: true, maxWidth: '20rem', accessor: (row) => row.description},
    {key: 'created_at', label: 'Created', ...DAY, accessor: (row) => row.createdAt, render: (row) => formatDateTime(row.createdAt)},
    {key: 'updated_at', label: 'Updated', ...DAY, hidden: true, accessor: (row) => row.updatedAt, render: (row) => formatDateTime(row.updatedAt)},
];

const SCHEMA: ListSchema = {
    searchFields: ['batch_name', 'file_name', 'description'],
    numberFields: ['total_rows', 'valid_rows', 'invalid_rows', 'onboarded_rows'],
    dateFields: ['created_at', 'updated_at'],
};

export function batchesPage(shell: Shell): Page {
    return ({outlet, query, signal}) => {
        const view = fromTemplate('tpl-batches');
        const panel = slot(view, 'panel');
        const host = slot(view, 'table');
        const refreshButton = slot(view, 'refresh');

        const requestedTab = query.get('tab') ?? 'all';
        let activeTab = requestedTab in SCOPES ? requestedTab : 'all';

        async function refreshCounts(): Promise<void> {
            await Promise.all(Object.entries(SCOPES).map(async ([id, scope]) => {
                const params = new URLSearchParams({$top: '1', $count: 'true'});
                if (scope) params.set('$filter', scope);
                try {
                    const {total} = await listUploads(params, signal);
                    tabs.setCount(id, total);
                    if (id === 'all') shell.setNavCount('batches', total);
                } catch {
                    tabs.setCount(id, null);
                }
            }));
        }

        async function load(tableQuery: Query): Promise<{ rows: Upload[]; total: number }> {
            try {
                return await listUploads(toODataParams(tableQuery, SCHEMA, SCOPES[activeTab] ?? null), tableQuery.signal);
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') throw error;
                throw new Error(describeError(error).detail);
            }
        }

        const tabs = bindTabs($('[role="tablist"]', panel), (id) => {
            activeTab = id;
            patchHashQuery({tab: id === 'all' ? null : id});
            table.setState({page: 1});
            void refreshCounts();
        });
        tabs.select(activeTab);
        outlet.append(view);

        const table = createDataTable<Upload>({
            container: host,
            label: 'Upload batches',
            columns: COLUMNS,
            data: load,
            rowId: (row) => row.id,
            pageSizes: [10, 20, 50, 100],
            pageSize: 20,
            sorts: [{field: 'created_at', dir: 'desc'}],
            persistKey: 'digibank:dt:batches',
            emptyMessage: 'No batches yet. Create a batch and upload a completed workbook to get started.',
            maxHeight: 'max(280px, calc(100dvh - 330px))',
            onStateChange: ({page, quick}) => {
                const search = quick && quick.field === '' && quick.op === 'contains' ? quick.value : null;
                patchHashQuery({search, page: page > 1 ? String(page) : null});
            },
        });

        const search = query.get('search')?.trim();
        const page = Number(query.get('page'));
        if (search || page > 1) {
            table.setState({
                ...(search ? {quick: {field: '', op: 'contains', value: search, value2: ''}} : {}),
                ...(page > 1 ? {page} : {}),
            });
        }

        refreshButton.addEventListener('click', () => {
            void table.refresh();
            void refreshCounts();
        });
        void refreshCounts();
        return () => table.destroy();
    };
}

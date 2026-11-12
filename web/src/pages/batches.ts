import {describeError} from '../api/client.js';
import {
    anyOf,
    DATE_FILTER,
    ENUM_FILTER,
    type ListSchema,
    literal,
    NUMBER_FILTER,
    TEXT_FILTER,
    toODataParams
} from '../api/odata.js';
import {listUploads, type Upload, type UploadStatus} from '../api/uploads.js';
import {$, el, fromTemplate, slot} from '../dom.js';
import {formatCount, formatDateTime} from '../format.js';
import type {Page} from '../router.js';
import {patchHashQuery} from '../router.js';
import type {Shell} from '../shell.js';
import {type ColumnConfig, createDataTable, type Query} from '../ui/dataTable.js';
import {statusBadge, statusOptions, UPLOAD_STATUS} from '../status.js';
import {bindTabs} from '../ui/tabs.js';

function statusScope(statuses: UploadStatus[]): string {
    return anyOf(statuses.map((status) => `status eq ${literal(status)}`));
}

const LIVE_STATUSES = ['created', 'uploading', 'uploaded', 'validating', 'committing'];
const LIVE_REFRESH_MS = 3000;

const SCOPES: Record<string, string | null> = {
    all: null,
    review: statusScope(['validated', 'validated_with_errors']),
    progress: statusScope(['created', 'uploading', 'uploaded', 'validating', 'committing']),
    committed: statusScope(['committed', 'committed_with_errors']),
    failed: statusScope(['failed']),
};

/** Unfinished uploads open where they can be resumed; the rest open the batch itself. */
function batchHref(row: Upload): string {
    const id = encodeURIComponent(row.id);
    return ['created', 'uploading', 'uploaded', 'validating'].includes(row.status) ? `#/batches/new?resume=${id}` : `#/batches/${id}`;
}

/** Zero is shown as a muted dash so the non-zero counts stand out. */
function count(value: number, tone?: 'success' | 'danger'): HTMLElement | string {
    if (value === 0) return el('span', {class: 'dt-null', 'aria-label': 'none'}, '–');
    return tone ? el('span', {class: `text-${tone}`}, formatCount(value)) : formatCount(value);
}

const COLUMNS: ColumnConfig<Upload>[] = [
    {
        key: 'batch_name',
        label: 'Batch',
        ...TEXT_FILTER,
        hideable: false,
        maxWidth: '22rem',
        accessor: (row) => row.batchName,
        render: (row) => el('a', {class: 'dt-link', href: batchHref(row)}, row.batchName),
    },
    {
        key: 'status',
        label: 'Status',
        ...ENUM_FILTER,
        options: statusOptions(UPLOAD_STATUS),
        accessor: (row) => row.status,
        render: (row) => statusBadge(UPLOAD_STATUS[row.status], row.status),
    },
    {
        key: 'total_rows',
        label: 'Rows', ...NUMBER_FILTER,
        accessor: (row) => row.totalRows,
        render: (row) => count(row.totalRows)
    },
    {
        key: 'valid_rows',
        label: 'Valid', ...NUMBER_FILTER,
        accessor: (row) => row.validRows,
        render: (row) => count(row.validRows, 'success')
    },
    {
        key: 'invalid_rows',
        label: 'Rejected', ...NUMBER_FILTER,
        accessor: (row) => row.invalidRows,
        render: (row) => count(row.invalidRows, 'danger')
    },
    {
        key: 'onboarded_rows',
        label: 'Onboarded', ...NUMBER_FILTER,
        accessor: (row) => row.onboardedRows,
        render: (row) => count(row.onboardedRows)
    },
    {
        key: 'next',
        label: 'Next step',
        sortable: false,
        filterable: false,
        render: (row) => row.status === 'validating' ? `Validating ${row.processedRows} of ${row.totalRows}` : UPLOAD_STATUS[row.status].next,
    },
    {key: 'file_name', label: 'File', ...TEXT_FILTER, hidden: true, maxWidth: '16rem', accessor: (row) => row.fileName},
    {
        key: 'description',
        label: 'Description', ...TEXT_FILTER,
        hidden: true,
        maxWidth: '20rem',
        accessor: (row) => row.description
    },
    {
        key: 'created_at',
        label: 'Created', ...DATE_FILTER,
        accessor: (row) => row.createdAt,
        render: (row) => formatDateTime(row.createdAt)
    },
    {
        key: 'updated_at',
        label: 'Updated', ...DATE_FILTER,
        hidden: true,
        accessor: (row) => row.updatedAt,
        render: (row) => formatDateTime(row.updatedAt)
    },
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

        // The list has no event stream, so while a visible batch is still being worked on it is reloaded every few seconds.
        let liveTimer: ReturnType<typeof setTimeout> | undefined;

        function refreshWhileInProgress(rows: Upload[]): void {
            clearTimeout(liveTimer);
            if (!rows.some((row) => LIVE_STATUSES.includes(row.status))) return;
            liveTimer = setTimeout(() => {
                void table.refresh();
                void refreshCounts();
            }, LIVE_REFRESH_MS);
        }

        async function load(tableQuery: Query): Promise<{ rows: Upload[]; total: number }> {
            try {
                const page = await listUploads(toODataParams(tableQuery, SCHEMA, SCOPES[activeTab] ?? null), tableQuery.signal);
                refreshWhileInProgress(page.rows);
                return page;
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
        return () => {
            clearTimeout(liveTimer);
            table.destroy();
        };
    };
}

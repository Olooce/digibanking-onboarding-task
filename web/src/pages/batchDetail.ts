import {describeError} from '../api/client.js';
import {downloadRejectedRows, exportRecords} from '../api/files.js';
import {ENUM_FILTER, type ListSchema, NUMBER_FILTER, TEXT_FILTER, toODataParams} from '../api/odata.js';
import {commitUpload, getUpload, listRecords, type UploadDetail, type UploadRecord} from '../api/uploads.js';
import {$, el, fromTemplate, replace, slot} from '../dom.js';
import {fileSlug, formatBytes, formatCount, formatDateTime} from '../format.js';
import {setIcon} from '../icons.js';
import type {Page} from '../router.js';
import type {Shell} from '../shell.js';
import {RECORD_STATUS, statusBadge, statusOptions, UPLOAD_STATUS} from '../status.js';
import {type ColumnConfig, createDataTable, type Query} from '../ui/dataTable.js';
import {bindDownloadButton} from '../ui/downloadButton.js';
import {createFormFields, type FieldConfig} from '../ui/form.js';
import {bindTabs} from '../ui/tabs.js';

const RECORD_COLUMNS: ColumnConfig<UploadRecord>[] = [
    {key: 'row_number', label: 'Row', ...NUMBER_FILTER, accessor: (row) => row.rowNumber},
    {
        key: 'status',
        label: 'Status',
        ...ENUM_FILTER,
        options: statusOptions(RECORD_STATUS),
        accessor: (row) => row.status,
        render: (row) => statusBadge(RECORD_STATUS[row.status], row.status),
    },
    {key: 'reason', label: 'Reason', ...TEXT_FILTER, maxWidth: '24rem', accessor: (row) => row.reason},
    {key: 'first_name', label: 'First name', ...TEXT_FILTER, accessor: (row) => row.firstName},
    {key: 'last_name', label: 'Last name', ...TEXT_FILTER, accessor: (row) => row.lastName},
    {key: 'member_number', label: 'Member no.', ...TEXT_FILTER, accessor: (row) => row.memberNumber},
    {key: 'phone_number', label: 'Phone', ...TEXT_FILTER, accessor: (row) => row.phoneNumber},
    {key: 'id_number', label: 'ID no.', ...TEXT_FILTER, accessor: (row) => row.idNumber},
    {key: 'date_of_birth', label: 'Date of birth', ...TEXT_FILTER, hidden: true, accessor: (row) => row.dateOfBirth},
    {key: 'email', label: 'Email', ...TEXT_FILTER, hidden: true, accessor: (row) => row.email},
    {key: 'branch', label: 'Branch', ...TEXT_FILTER, accessor: (row) => row.branch},
    {key: 'account_type', label: 'Account type', ...TEXT_FILTER, accessor: (row) => row.accountType},
    {
        key: 'member_id',
        label: 'Member',
        sortable: false,
        filterable: false,
        render: (row) => row.memberId ? el('a', {
            class: 'dt-link',
            href: `#/members/${encodeURIComponent(row.memberId)}`
        }, 'View member') : '',
    },
];

const RECORD_SCHEMA: ListSchema = {
    searchFields: ['first_name', 'last_name', 'member_number', 'phone_number', 'id_number', 'email', 'reason'],
    numberFields: ['row_number'],
};

const COMMIT_FIELDS: FieldConfig[] = [
    {
        name: 'reviewed',
        label: 'I have reviewed the status and reason of every row.',
        type: 'checkbox',
        required: true,
        hint: 'Only valid rows are onboarded. Invalid and duplicate rows stay in this batch for review or download.',
    },
];

/** Status tabs above the records table. "all" shows every row. */
const TABS = ['all', 'valid', 'invalid', 'duplicate', 'onboarded'];
const COMMITTABLE = ['validated', 'validated_with_errors'];
const IN_PROGRESS = ['created', 'uploading', 'uploaded', 'validating'];

export function batchDetailPage(shell: Shell): Page {
    return async ({outlet, params, signal}) => {
        const uploadId = params.id ?? '';
        let batch: UploadDetail;
        try {
            batch = await getUpload(uploadId, signal);
        } catch (error) {
            if (signal.aborted) return;
            const {title, detail} = describeError(error);
            const view = fromTemplate('tpl-load-error');
            slot(view, 'title').textContent = title;
            slot(view, 'message').textContent = detail;
            outlet.append(view);
            return;
        }

        const view = fromTemplate('tpl-batch');
        const commitForm = slot<HTMLFormElement>(view, 'commit');
        const commitButton = slot<HTMLButtonElement>(view, 'commit-button');
        const commitLabel = slot(view, 'commit-label');
        const notice = slot(view, 'notice');
        const rejectedButton = slot<HTMLButtonElement>(view, 'rejected');
        const fields = createFormFields('commit', COMMIT_FIELDS);
        slot(view, 'commit-fields').replaceWith(fields.element);
        let activeTab = 'all';
        let counts: Record<string, number> = {};
        let countsLoaded = false;
        let commitResultShown = false;
        const exportButtons = [slot<HTMLButtonElement>(view, 'export-csv'), slot<HTMLButtonElement>(view, 'export-xlsx')];
        const exportHint = slot(view, 'export-hint');

        // The API exports one status at a time, so exporting needs a status tab.
        function updateExport(): void {
            for (const button of exportButtons) button.disabled = activeTab === 'all';
            exportHint.hidden = activeTab !== 'all';
        }

        const tabs = bindTabs($('[role="tablist"]', view), (id) => {
            activeTab = id;
            updateExport();
            table.setState({page: 1});
        });

        function showNotice(tone: 'info' | 'success' | 'warning' | 'danger', title: string, message: string, link?: {
            href: string;
            label: string
        }): void {
            notice.hidden = false;
            notice.className = `alert alert--${tone}`;
            setIcon(slot<SVGUseElement>(notice, 'notice-icon'), tone === 'success' ? 'checkCircle' : tone === 'danger' ? 'xCircle' : tone === 'warning' ? 'alert' : 'info');
            slot(notice, 'notice-title').textContent = title;
            slot(notice, 'notice-text').textContent = message;
            const anchor = slot<HTMLAnchorElement>(notice, 'notice-link');
            anchor.hidden = !link;
            anchor.href = link?.href ?? '';
            anchor.textContent = link?.label ?? '';
        }

        function renderBatch(): void {
            shell.setPageLabel(batch.batchName);
            slot(outlet, 'name').textContent = batch.batchName;
            replace(slot(outlet, 'status'), statusBadge(UPLOAD_STATUS[batch.status], batch.status));
            slot(outlet, 'description').textContent = batch.description || 'No description.';
            replace(slot(outlet, 'meta'), [
                el('dt', {}, 'File'), el('dd', {}, `${batch.fileName} · ${formatBytes(batch.fileSize)}`),
                el('dt', {}, 'Created'), el('dd', {}, formatDateTime(batch.createdAt)),
                el('dt', {}, 'Last updated'), el('dd', {}, formatDateTime(batch.updatedAt)),
                el('dt', {}, 'Rows'), el('dd', {}, formatCount(batch.totalRows)),
            ]);
            const valid = counts.valid ?? 0;
            const rejected = (counts.invalid ?? 0) + (counts.duplicate ?? 0);
            for (const status of ['valid', 'invalid', 'duplicate', 'onboarded']) {
                slot(outlet, `count-${status}`).textContent = formatCount(counts[status] ?? 0);
            }
            rejectedButton.hidden = rejected === 0;
            commitForm.hidden = !COMMITTABLE.includes(batch.status) || valid === 0;
            commitLabel.textContent = `Commit ${formatCount(valid)} valid ${valid === 1 ? 'row' : 'rows'}`;
            // The status notice needs the row counts, and must not replace the result of a commit.
            if (!countsLoaded || commitResultShown) return;
            notice.hidden = true;
            if (IN_PROGRESS.includes(batch.status)) {
                showNotice('info', 'This batch is not ready for review', 'The upload or validation has not finished yet.', {
                    href: `#/batches/new?resume=${encodeURIComponent(batch.id)}`,
                    label: 'Follow progress'
                });
            } else if (batch.status === 'failed') {
                showNotice('danger', 'Validation failed', 'The workbook could not be read. Check that it uses the template, then start a new batch.', {
                    href: '#/batches/new',
                    label: 'Start a new batch'
                });
            } else if (COMMITTABLE.includes(batch.status) && valid === 0) {
                showNotice('warning', 'No rows can be committed', 'Every row is invalid or a duplicate. Download the rejected rows, correct them and upload a new batch.');
            }
        }

        async function load(query: Query): Promise<{ rows: UploadRecord[]; total: number }> {
            const params = toODataParams(query, RECORD_SCHEMA);
            if (activeTab !== 'all') params.set('status', activeTab);
            try {
                const page = await listRecords(uploadId, params, query.signal);
                counts = page.statusCounts;
                countsLoaded = true;
                for (const tab of TABS) tabs.setCount(tab, tab === 'all' ? Object.values(counts).reduce((sum, n) => sum + n, 0) : counts[tab] ?? 0);
                renderBatch();
                return page;
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') throw error;
                throw new Error(describeError(error).detail);
            }
        }

        /** The export follows what the table shows: the active status tab, filters and sort, but every page. */
        function exportQuery(): URLSearchParams {
            const params = toODataParams(table.getState(), RECORD_SCHEMA);
            const query = new URLSearchParams();
            for (const key of ['$filter', '$orderby']) {
                const value = params.get(key);
                if (value) query.set(key, value);
            }
            query.set('status', activeTab);
            return query;
        }

        commitForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!fields.validate()) return;
            commitButton.disabled = true;
            commitButton.setAttribute('aria-busy', 'true');
            try {
                const result = await commitUpload(uploadId, signal);
                batch = result.upload;
                commitResultShown = true;
                const left = (counts.invalid ?? 0) + (counts.duplicate ?? 0) + result.conflictRows;
                const conflicts = result.conflictRows ? ` ${result.conflictRows} valid rows could not be committed because the member was onboarded meanwhile.` : '';
                showNotice('success', `${formatCount(result.committedRows)} members onboarded`,
                    `The API confirmed the commit. ${formatCount(left)} rows were not committed and stay in this batch.${conflicts}`,
                    {href: '#/members', label: 'View onboarded members'});
                tabs.select('onboarded');
                activeTab = 'onboarded';
                updateExport();
                table.setState({page: 1});
            } catch (error) {
                if (signal.aborted) return;
                const {title, detail} = describeError(error);
                showNotice('danger', `Not committed. ${title}`, detail);
            } finally {
                commitButton.disabled = false;
                commitButton.removeAttribute('aria-busy');
            }
        });

        bindDownloadButton(rejectedButton, 'Rejected rows', () => downloadRejectedRows(uploadId, fileSlug(batch.batchName)));
        bindDownloadButton(exportButtons[0]!, 'Export', () => exportRecords(uploadId, exportQuery(), 'csv', fileSlug(batch.batchName)));
        bindDownloadButton(exportButtons[1]!, 'Export', () => exportRecords(uploadId, exportQuery(), 'xlsx', fileSlug(batch.batchName)));

        tabs.select(activeTab);
        updateExport();
        const host = slot(view, 'table');
        outlet.append(view);
        renderBatch();

        const table = createDataTable<UploadRecord>({
            container: host,
            label: 'Batch records',
            columns: RECORD_COLUMNS,
            data: load,
            rowId: (row) => row.id,
            pageSizes: [10, 20, 50, 100],
            pageSize: 20,
            sorts: [{field: 'row_number', dir: 'asc'}],
            emptyMessage: 'No rows in this view.',
        });
        return () => table.destroy();
    };
}


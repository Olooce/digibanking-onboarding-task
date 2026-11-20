import {describeError} from '../api/client.js';
import {downloadRejectedRows, exportRecords} from '../api/files.js';
import {ENUM_FILTER, type ListSchema, NUMBER_FILTER, TEXT_FILTER, toODataParams} from '../api/odata.js';
import {commitUpload, getUpload, listRecords, type UploadDetail, type UploadRecord} from '../api/uploads.js';
import {$, el, fromTemplate, replace, slot} from '../dom.js';
import {fileSlug, formatBytes, formatCount, formatDateTime} from '../format.js';
import {int} from '../api/xml.js';
import {setIcon} from '../icons.js';
import type {Page} from '../router.js';
import type {Shell} from '../shell.js';
import {RECORD_STATUS, statusBadge, statusOptions, UPLOAD_STATUS} from '../status.js';
import {type ColumnConfig, createDataTable, type Query} from '../ui/dataTable.js';
import {bindDownloadButton} from '../ui/downloadButton.js';
import {createFormFields, type FieldConfig} from '../ui/form.js';
import {setProgress} from '../ui/progress.js';
import {bindTabs} from '../ui/tabs.js';
import {watchUploadEvents} from '../upload/events.js';

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
        // Every row has the same visible text, so hidden text tells screen reader users which member it opens.
        render: (row) => row.memberId ? el('a', {
            class: 'dt-link',
            href: `#/members/${encodeURIComponent(row.memberId)}`
        }, ['View member', el('span', {class: 'sr-only'}, ` ${row.firstName} ${row.lastName}`)]) : '',
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
/** The workbook has not been fully received and verified yet; the new batch page finishes the upload. */
const UPLOAD_UNFINISHED = ['created', 'uploading', 'uploaded'];
/** Rows are being checked or committed right now. */
const RUNNING = ['validating', 'committing'];
/** While the batch is in one of these states its rows are still changing, so the page follows its events. */
const LIVE_STATUSES = [...UPLOAD_UNFINISHED, ...RUNNING];
const ROW_EVENTS = ['processing_started', 'row_processed', 'commit_started', 'row_committed'];
const FINAL_EVENTS = ['validation_completed', 'commit_completed', 'failed'];
/** Rows arrive several times a second, so the table is fetched again at most once a second. */
const LIVE_REFRESH_MS = 1000;

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

        // Live strip above the table: how far the running validation or commit has got.
        const live = slot(view, 'live');
        const liveBadge = slot(view, 'live-badge');
        const liveLabel = slot(view, 'live-label');
        const liveText = slot(view, 'live-text');
        const liveBar = slot<HTMLProgressElement>(view, 'live-bar');
        const livePause = slot<HTMLButtonElement>(view, 'live-pause');
        const livePauseIcon = slot<SVGUseElement>(view, 'live-pause-icon');
        const livePauseLabel = slot(view, 'live-pause-label');
        /** Row numbers finished in the current run. A set, so an event replayed after a reconnect counts once. */
        const liveRows = new Set<number>();
        let liveTotal = 0;
        /** While paused the table stops changing; the progress bar keeps counting. */
        let paused = false;

        // Rows that appeared or changed status since the same view was last drawn get a short highlight.
        let lastViewKey = '';
        let lastStatuses = new Map<string, string>();
        let freshIds = new Set<string>();

        function startLive(label: string, total: number): void {
            live.hidden = false;
            liveLabel.textContent = label;
            liveTotal = total;
            liveRows.clear();
            showLiveProgress(0);
        }

        function showLiveProgress(done: number): void {
            setProgress(liveBar, liveTotal > 0 ? done : null, liveTotal);
            liveText.textContent = liveTotal > 0 ? `${formatCount(done)} of ${formatCount(liveTotal)}` : '';
        }

        function setPaused(next: boolean): void {
            paused = next;
            livePauseLabel.textContent = paused ? 'Resume updates' : 'Pause updates';
            setIcon(livePauseIcon, paused ? 'play' : 'pause');
            liveBadge.className = paused ? 'badge badge--warning' : 'badge badge--info badge--live';
            liveBadge.textContent = paused ? 'Paused' : 'Live';
            if (!paused) void table.refresh({quiet: true});
        }

        livePause.addEventListener('click', () => setPaused(!paused));

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
            if (UPLOAD_UNFINISHED.includes(batch.status)) {
                showNotice('info', 'Upload not finished', 'The workbook has not been fully received yet. Resume the upload to validate its rows; they appear here as they are checked.', {
                    href: `#/batches/new?resume=${encodeURIComponent(batch.id)}`,
                    label: 'Resume upload'
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
                const viewKey = `${activeTab}?${params.toString()}`;
                const before = viewKey === lastViewKey ? lastStatuses : null;
                freshIds = new Set(before ? page.rows.filter((row) => before.get(row.id) !== row.status).map((row) => row.id) : []);
                lastViewKey = viewKey;
                lastStatuses = new Map(page.rows.map((row) => [row.id, row.status]));
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
            // The commit request returns when every row is done, so meanwhile the table is fetched again
            // every second and the strip counts the rows onboarded so far.
            const onboardedBefore = counts.onboarded ?? 0;
            startLive('Committing rows', counts.valid ?? 0);
            const poll = setInterval(async () => {
                if (paused) return;
                await table.refresh({quiet: true});
                showLiveProgress((counts.onboarded ?? 0) - onboardedBefore);
            }, LIVE_REFRESH_MS);
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
                clearInterval(poll);
                live.hidden = true;
                commitButton.disabled = false;
                commitButton.removeAttribute('aria-busy');
            }
        });

        const fileBase = fileSlug(batch.batchName);
        bindDownloadButton(rejectedButton, 'Rejected rows', (onProgress) => downloadRejectedRows(uploadId, fileBase, onProgress));
        bindDownloadButton(exportButtons[0]!, 'Export', (onProgress) => exportRecords(uploadId, exportQuery(), 'csv', fileBase, onProgress));
        bindDownloadButton(exportButtons[1]!, 'Export', (onProgress) => exportRecords(uploadId, exportQuery(), 'xlsx', fileBase, onProgress));

        tabs.select(activeTab);
        updateExport();
        const host = slot(view, 'table');
        outlet.append(view);
        renderBatch();

        async function reloadBatch(): Promise<void> {
            try {
                batch = await getUpload(uploadId, signal);
                renderBatch();
            } catch {
                // The table's own error state reports a lost connection.
            }
            void table.refresh({quiet: true});
        }

        let refreshTimer: ReturnType<typeof setTimeout> | undefined;
        signal.addEventListener('abort', () => clearTimeout(refreshTimer), {once: true});

        /** Fetches the visible rows again within a second, unless a fetch is already waiting or updates are paused. */
        function scheduleRefresh(): void {
            if (paused || refreshTimer !== undefined) return;
            refreshTimer = setTimeout(() => {
                refreshTimer = undefined;
                void table.refresh({quiet: true});
            }, LIVE_REFRESH_MS);
        }

        function followLiveChanges(): void {
            watchUploadEvents(uploadId, {
                onConnection() {
                    // Missed events are replayed after a reconnect, so nothing is needed here.
                },
                onEvent(type, payload) {
                    if (type === 'processing_started') {
                        startLive('Validating rows', int(payload, 'total_rows'));
                    } else if (type === 'commit_started') {
                        startLive('Committing rows', int(payload, 'eligible_rows'));
                    } else if (type === 'row_processed' || type === 'row_committed') {
                        liveRows.add(int(payload, 'row_number'));
                        showLiveProgress(liveRows.size);
                    }
                    // A run starting or ending changes the batch status, row count and notice, so the batch is fetched again.
                    if (FINAL_EVENTS.includes(type)) {
                        live.hidden = true;
                        clearTimeout(refreshTimer);
                        refreshTimer = undefined;
                        void reloadBatch();
                    } else if (type === 'processing_started' || type === 'commit_started') {
                        void reloadBatch();
                    } else if (ROW_EVENTS.includes(type)) {
                        scheduleRefresh();
                    }
                },
            }, signal);
        }

        // Until validation has finished the newest rows are listed first, so each one appears at the top as it is done.
        const running = LIVE_STATUSES.includes(batch.status);
        const table = createDataTable<UploadRecord>({
            container: host,
            label: 'Batch records',
            columns: RECORD_COLUMNS,
            data: load,
            rowId: (row) => row.id,
            rowClass: (row) => freshIds.has(row.id) ? 'dt-row--fresh' : undefined,
            pageSizes: [10, 20, 50, 100],
            pageSize: 20,
            sorts: [{field: 'row_number', dir: running ? 'desc' : 'asc'}],
            emptyMessage: running ? 'Rows appear here as they are checked.' : 'No rows in this view.',
        });
        if (LIVE_STATUSES.includes(batch.status)) followLiveChanges();
        return () => table.destroy();
    };
}


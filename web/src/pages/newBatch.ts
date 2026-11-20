import {describeError} from '../api/client.js';
import {downloadTemplate} from '../api/files.js';
import {completeUpload, createUpload, getUpload, type UploadDetail} from '../api/uploads.js';
import {child, int, items, text} from '../api/xml.js';
import {el, fromTemplate, slot} from '../dom.js';
import {formatBytes} from '../format.js';
import {icon, type IconName, setIcon} from '../icons.js';
import type {Page} from '../router.js';
import {patchHashQuery} from '../router.js';
import {bindDownloadButton} from '../ui/downloadButton.js';
import {createFormFields, type FieldConfig} from '../ui/form.js';
import {setProgress} from '../ui/progress.js';
import {watchUploadEvents} from '../upload/events.js';
import {retryWhileOffline} from '../upload/retry.js';
import {sha256Hex} from '../upload/sha256.js';
import {sendMissingChunks} from '../upload/transfer.js';

const BATCH_FIELDS: FieldConfig[] = [
    {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        maxLength: 1000,
        rows: 3,
        hint: 'Added to every batch created from these workbooks.',
    },
    {
        name: 'workbooks',
        label: 'Workbooks',
        type: 'file',
        required: true,
        multiple: true,
        accept: '.xlsx',
        maxBytes: 50 * 1024 * 1024,
        hint: 'Up to 50 MB each. Use the onboarding template.',
    },
];

const NAME_MAX_LENGTH = 120;

/**
 * How many workbooks are sent at the same time. Over HTTP/1.1 a browser keeps at most six connections open
 * to the API, and each running workbook holds one (a part upload, then its live event stream), so three
 * leaves room for the rest of the console. The others wait in the list as "Queued".
 */
const MAX_PARALLEL = 3;

type Tone = 'info' | 'success' | 'warning' | 'danger';

/**
 * Where a workbook is. 'failed' means sending it went wrong and it can be retried; 'rejected' means
 * validation refused the workbook itself (for example missing columns), so it has to be fixed first.
 */
type JobState =
    | 'ready' | 'needsFile' | 'queued' | 'preparing' | 'uploading' | 'verifying'
    | 'validating' | 'validated' | 'review' | 'failed' | 'rejected';

/** The badge shown for each state of a workbook. `live` adds the pulsing dot while work is happening. */
const JOB_STATES: Record<JobState, { label: string; tone: string; live?: boolean }> = {
    ready: {label: 'Ready', tone: 'neutral'},
    needsFile: {label: 'File needed', tone: 'warning'},
    queued: {label: 'Queued', tone: 'neutral'},
    preparing: {label: 'Preparing', tone: 'info', live: true},
    uploading: {label: 'Uploading', tone: 'info', live: true},
    verifying: {label: 'Verifying', tone: 'info', live: true},
    validating: {label: 'Validating', tone: 'info', live: true},
    validated: {label: 'Validated', tone: 'success'},
    review: {label: 'Validated with errors', tone: 'warning'},
    failed: {label: 'Failed', tone: 'danger'},
    rejected: {label: 'Rejected', tone: 'danger'},
};

/** States in which the workbook still has to be sent or checked, so leaving the page would interrupt it. */
const BUSY_STATES: JobState[] = ['queued', 'preparing', 'uploading', 'verifying'];
const FINISHED_STATES: JobState[] = ['validated', 'review', 'failed', 'rejected'];

const TONE_ICON: Record<Tone, IconName> = {info: 'info', success: 'checkCircle', warning: 'wifiOff', danger: 'xCircle'};

/** The parts of one workbook panel (template tpl-batch-job) that change. */
interface JobView {
    item: HTMLLIElement;
    name: HTMLInputElement;
    nameHint: HTMLElement;
    nameError: HTMLElement;
    state: HTMLElement;
    remove: HTMLButtonElement;
    meters: HTMLElement;
    uploadBar: HTMLProgressElement;
    uploadText: HTMLElement;
    validateBar: HTMLProgressElement;
    validateText: HTMLElement;
    message: HTMLElement;
    foot: HTMLElement;
    valid: HTMLElement;
    invalid: HTMLElement;
    duplicate: HTMLElement;
    watch: HTMLAnchorElement;
    review: HTMLAnchorElement;
}

/** One workbook in the list and the batch it becomes. */
interface Job {
    /** The chosen file. Null while resuming, until the same file is chosen again. */
    file: File | null;
    /** Set once the server has created the batch, or straight away when resuming. */
    batch: UploadDetail | null;
    /** Sent with the create request. Reused on a retry, so the server never creates the batch twice. */
    idempotencyKey: string;
    state: JobState;
    /** Status of each validated row, keyed by row number, so a replayed event cannot be counted twice. */
    rows: Map<number, string>;
    totalRows: number;
    view: JobView;
}

/** The workbook still has to be sent while the batch is in one of these states. */
function needsFile(upload: UploadDetail | null): boolean {
    return upload === null || upload.status === 'created' || upload.status === 'uploading';
}

/** Suggested batch name for a file: its name without the extension. */
function nameFromFile(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, '').slice(0, NAME_MAX_LENGTH);
}

function countRows(job: Job, status: string): number {
    let count = 0;
    for (const rowStatus of job.rows.values()) if (rowStatus === status) count += 1;
    return count;
}

function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

export const newBatchPage: Page = async ({outlet, query, signal}) => {
    const view = fromTemplate('tpl-new-batch');
    const title = slot(view, 'title');
    const subtitle = slot(view, 'subtitle');
    const formElement = slot<HTMLFormElement>(view, 'form');
    const submit = slot<HTMLButtonElement>(view, 'submit');
    const submitLabel = slot(view, 'submit-label');
    const jobsSection = slot(view, 'jobs-section');
    const jobList = slot(view, 'jobs');
    const notice = slot(view, 'notice');
    const noticeIcon = slot<SVGUseElement>(view, 'notice-icon');
    const noticeTitle = slot(view, 'notice-title');
    const noticeText = slot(view, 'notice-text');
    const noticeLink = slot<HTMLAnchorElement>(view, 'notice-link');
    const restartLink = slot(view, 'restart');
    const connection = slot(view, 'connection');
    const overallBar = slot<HTMLProgressElement>(view, 'overall-bar');
    const overallText = slot(view, 'overall-text');
    const validCount = slot(view, 'count-valid');
    const invalidCount = slot(view, 'count-invalid');
    const duplicateCount = slot(view, 'count-duplicate');
    const log = slot(view, 'log');

    const form = createFormFields('batch', BATCH_FIELDS);
    slot(view, 'fields').replaceWith(form.element);
    bindDownloadButton(slot<HTMLButtonElement>(view, 'template'), 'Template', downloadTemplate);
    outlet.append(view);

    let jobs: Job[] = [];
    let jobCount = 0;
    /** True while resuming batches from the address: the list then comes from the server, not from the files. */
    let resuming = false;
    /** True once the first upload has started. The list can no longer change. */
    let started = false;
    let running = false;
    let offline = false;

    function showNotice(tone: Tone, heading: string, message: string, links: {
        href?: string;
        label?: string;
        restart?: boolean;
    } = {}): void {
        notice.hidden = false;
        notice.className = `alert alert--${tone}`;
        setIcon(noticeIcon, TONE_ICON[tone]);
        noticeTitle.textContent = heading;
        noticeText.textContent = message;
        noticeLink.hidden = !links.href;
        noticeLink.href = links.href ?? '';
        noticeLink.textContent = links.label ?? '';
        restartLink.hidden = !links.restart;
    }

    function addLog(message: string, tone: Tone, iconName: IconName): void {
        const time = new Date().toLocaleTimeString();
        log.prepend(el('li', {class: `timeline__item timeline__item--${tone}`}, [
            icon(iconName),
            el('span', {}, message),
            el('time', {class: 'timeline__time'}, time),
        ]));
    }

    function setConnection(state: 'live' | 'offline' | 'reconnecting' | null): void {
        const labels = {live: 'Live', offline: 'Offline', reconnecting: 'Reconnecting'};
        connection.hidden = state === null;
        connection.className = `badge badge--${state === 'live' ? 'success' : 'warning'}`;
        connection.textContent = state ? labels[state] : '';
    }

    function onOffline(): void {
        if (!offline) addLog('Connection lost', 'warning', 'wifiOff');
        offline = true;
        setConnection('offline');
        showNotice('warning', 'Connection lost', 'Nothing has been lost. Each upload carries on from the same point when the connection returns.');
    }

    function onBackOnline(): void {
        if (!offline) return;
        offline = false;
        setConnection(null);
        addLog('Connection restored', 'success', 'refresh');
        showNotice('info', 'Connection restored', 'Uploads are carrying on.');
    }

    /** The batch name as typed, for messages in the activity log. */
    function jobName(job: Job): string {
        return job.view.name.value.trim() || job.file?.name || job.batch?.fileName || 'Workbook';
    }

    /** Totals across every workbook, shown in the Progress card. */
    function updateOverall(): void {
        const finished = jobs.filter((job) => FINISHED_STATES.includes(job.state)).length;
        setProgress(overallBar, finished, jobs.length);
        overallText.textContent = started ? `${finished} of ${jobs.length}` : 'Not started';
        let valid = 0;
        let invalid = 0;
        let duplicate = 0;
        for (const job of jobs) {
            valid += countRows(job, 'valid');
            invalid += countRows(job, 'invalid');
            duplicate += countRows(job, 'duplicate');
        }
        validCount.textContent = String(valid);
        invalidCount.textContent = String(invalid);
        duplicateCount.textContent = String(duplicate);
    }

    function setJobState(job: Job, state: JobState, message = ''): void {
        job.state = state;
        const badge = JOB_STATES[state];
        job.view.state.className = `badge badge--${badge.tone}${badge.live ? ' badge--live' : ''}`;
        job.view.state.textContent = badge.label;
        job.view.item.dataset.state = state;
        job.view.message.textContent = message;
        job.view.message.hidden = !message;
        // The bars appear once there is something to measure: when the work starts, or for an existing batch.
        job.view.meters.hidden = job.batch === null && state === 'ready';
        updateOverall();
    }

    /**
     * The upload bar counts bytes. The server reports how many parts it has received, so the bytes sent are
     * parts x part size, capped at the file size because the last part is usually shorter.
     */
    function showUploaded(job: Job, receivedParts: number): void {
        const batch = job.batch;
        if (!batch) return;
        const sent = Math.min(receivedParts * batch.chunkSize, batch.fileSize);
        setProgress(job.view.uploadBar, sent, batch.fileSize);
        job.view.uploadText.textContent = receivedParts >= batch.chunkCount
            ? 'Complete'
            : `${formatBytes(sent)} of ${formatBytes(batch.fileSize)}`;
    }

    function showRowCounts(job: Job): void {
        job.view.foot.hidden = false;
        job.view.valid.textContent = String(countRows(job, 'valid'));
        job.view.invalid.textContent = String(countRows(job, 'invalid'));
        job.view.duplicate.textContent = String(countRows(job, 'duplicate'));
        setProgress(job.view.validateBar, job.totalRows ? job.rows.size : null, job.totalRows);
        job.view.validateText.textContent = job.totalRows ? `${job.rows.size} of ${job.totalRows} rows` : 'Starting';
        updateOverall();
    }

    function updateSubmit(): void {
        const failed = jobs.filter((job) => job.state === 'failed').length;
        const waiting = jobs.filter((job) => job.state === 'ready' || job.state === 'needsFile').length;
        if (started && !running && failed > 0) {
            submitLabel.textContent = `Retry ${plural(failed, 'failed workbook', 'failed workbooks')}`;
        } else if (resuming) {
            submitLabel.textContent = jobs.some((job) => needsFile(job.batch)) ? 'Resume upload' : 'Start validation';
        } else {
            submitLabel.textContent = waiting > 1 ? `Upload and validate ${waiting} workbooks` : 'Upload and validate';
        }
        submit.disabled = running;
        submit.hidden = started && !running && failed === 0;
    }

    /** Builds a workbook panel from the template and adds it to the list. */
    function addJob(file: File | null, batch: UploadDetail | null): Job {
        jobCount += 1;
        const id = `batch-job-${jobCount}`;
        const fragment = fromTemplate('tpl-batch-job');
        const jobView: JobView = {
            item: slot<HTMLLIElement>(fragment, 'item'),
            name: slot<HTMLInputElement>(fragment, 'name'),
            nameHint: slot(fragment, 'name-hint'),
            nameError: slot(fragment, 'name-error'),
            state: slot(fragment, 'state'),
            remove: slot<HTMLButtonElement>(fragment, 'remove'),
            meters: slot(fragment, 'meters'),
            uploadBar: slot<HTMLProgressElement>(fragment, 'upload-bar'),
            uploadText: slot(fragment, 'upload-text'),
            validateBar: slot<HTMLProgressElement>(fragment, 'validate-bar'),
            validateText: slot(fragment, 'validate-text'),
            message: slot(fragment, 'message'),
            foot: slot(fragment, 'foot'),
            valid: slot(fragment, 'valid'),
            invalid: slot(fragment, 'invalid'),
            duplicate: slot(fragment, 'duplicate'),
            watch: slot<HTMLAnchorElement>(fragment, 'watch'),
            review: slot<HTMLAnchorElement>(fragment, 'review'),
        };
        const fileName = file?.name ?? batch?.fileName ?? '';
        const fileSize = file?.size ?? batch?.fileSize ?? 0;

        // Ids tie each label, hint and progress bar to this panel only, since the panel is repeated.
        const fileTitle = slot(fragment, 'file-name');
        fileTitle.id = `${id}-file`;
        fileTitle.textContent = fileName;
        slot(fragment, 'file-size').textContent = formatBytes(fileSize);
        slot(fragment, 'name-label').setAttribute('for', `${id}-name`);
        jobView.name.id = `${id}-name`;
        jobView.nameHint.id = `${id}-name-hint`;
        jobView.nameError.id = `${id}-name-error`;
        jobView.name.setAttribute('aria-describedby', `${id}-name-hint ${id}-name-error`);
        jobView.name.value = batch?.batchName ?? nameFromFile(fileName);
        jobView.name.readOnly = batch !== null;
        // Named "Upload riverside.xlsx" and so on, so each bar is told apart from the bars of the other workbooks.
        slot(fragment, 'upload-label').id = `${id}-upload`;
        slot(fragment, 'validate-label').id = `${id}-validate`;
        jobView.uploadBar.setAttribute('aria-labelledby', `${id}-upload ${id}-file`);
        jobView.validateBar.setAttribute('aria-labelledby', `${id}-validate ${id}-file`);
        jobView.uploadText.textContent = 'Waiting';
        jobView.validateText.textContent = 'Waiting';
        jobView.remove.setAttribute('aria-label', `Remove ${fileName}`);
        jobView.remove.hidden = batch !== null;

        const job: Job = {
            file,
            batch,
            idempotencyKey: crypto.randomUUID(),
            state: 'ready',
            rows: new Map(),
            totalRows: 0,
            view: jobView,
        };
        jobView.remove.addEventListener('click', () => {
            if (job.file) form.removeFile('workbooks', job.file);
        });
        jobView.name.addEventListener('input', () => setNameError(job, null));
        jobList.append(jobView.item);
        jobs.push(job);
        jobsSection.hidden = false;
        return job;
    }

    function setNameError(job: Job, message: string | null): void {
        job.view.nameError.textContent = message ?? '';
        job.view.nameError.hidden = !message;
        job.view.name.setAttribute('aria-invalid', String(Boolean(message)));
    }

    /** New batches: keeps the panels of files still chosen (and the names typed in them) and adds the new files. */
    function syncJobsWithFiles(files: File[]): void {
        for (const job of jobs) {
            if (job.file && !files.includes(job.file)) job.view.item.remove();
        }
        jobs = jobs.filter((job) => job.file !== null && files.includes(job.file));
        for (const file of files) {
            if (!jobs.some((job) => job.file === file)) setJobState(addJob(file, null), 'ready');
        }
        jobsSection.hidden = jobs.length === 0;
        updateSubmit();
    }

    /** Resumed batches: pairs each chosen file with the batch that has the same file name and size. */
    function matchResumedFiles(files: File[]): void {
        const unknown: string[] = [];
        for (const file of files) {
            const job = jobs.find((candidate) => candidate.batch?.fileName === file.name && candidate.batch.fileSize === file.size);
            if (!job) {
                unknown.push(file.name);
                continue;
            }
            job.file = file;
            job.view.nameHint.hidden = true;
            if (job.state === 'needsFile') setJobState(job, 'ready');
        }
        if (unknown.length) form.setError('workbooks', `Not part of these batches: ${unknown.join(', ')}.`);
    }

    form.onFilesChange('workbooks', (files) => {
        if (resuming) matchResumedFiles(files);
        else syncJobsWithFiles(files);
    });

    /** Checks the batch names, and when resuming that every workbook still to be sent has been chosen again. */
    function validateJobs(focusFirstError: boolean): boolean {
        const stillNeeded = jobs.filter((job) => job.state === 'needsFile').map((job) => job.batch?.fileName ?? '');
        if (stillNeeded.length) form.setError('workbooks', `Choose ${stillNeeded.join(', ')} again to continue.`);

        let firstInvalid: HTMLInputElement | null = null;
        for (const job of jobs) {
            if (job.state !== 'ready' || job.view.name.readOnly) continue;
            const name = job.view.name.value.trim();
            let message: string | null = null;
            if (name === '') message = 'Enter a batch name.';
            else if (name.length > NAME_MAX_LENGTH) message = `Use at most ${NAME_MAX_LENGTH} characters.`;
            setNameError(job, message);
            if (message && !firstInvalid) firstInvalid = job.view.name;
        }
        // The file field comes before the list, so its error is the first one on the page.
        if (focusFirstError && stillNeeded.length) form.focus('workbooks');
        else if (focusFirstError) firstInvalid?.focus();
        return firstInvalid === null && stillNeeded.length === 0;
    }

    function rememberBatchesInAddress(): void {
        // A reload or a link from the batch list can then resume these batches.
        const ids = jobs.flatMap((job) => job.batch ? [job.batch.id] : []);
        patchHashQuery({resume: ids});
    }

    /** Creates the batch (or reloads it when resuming), then sends the parts the server does not have yet. */
    async function sendWorkbook(job: Job, existing: UploadDetail | null): Promise<UploadDetail | null> {
        const file = job.file;
        if (!file) {
            setJobState(job, 'needsFile');
            return null;
        }
        setJobState(job, 'preparing');
        setProgress(job.view.uploadBar, null);
        job.view.uploadText.textContent = 'Checking the file';
        const digest = await sha256Hex(file);
        let upload: UploadDetail;

        if (existing) {
            if (digest !== existing.fileSha256) {
                setJobState(job, 'failed', `This is not the file this batch started with. Choose ${existing.fileName} (${formatBytes(existing.fileSize)}).`);
                return null;
            }
            upload = await retryWhileOffline(() => getUpload(existing.id, signal), onOffline, signal);
            addLog(`${jobName(job)}: resuming, ${upload.uploadedChunks.length} of ${upload.chunkCount} parts already received`, 'info', 'refresh');
        } else {
            const details = {
                batchName: job.view.name.value.trim(),
                description: form.getValue('description').trim(),
                fileName: file.name,
                fileSize: file.size,
                fileSha256: digest,
            };
            upload = await retryWhileOffline(() => createUpload(details, job.idempotencyKey, signal), onOffline, signal);
            addLog(`${jobName(job)}: batch created`, 'info', 'layers');
        }
        job.batch = upload;
        rememberBatchesInAddress();

        setJobState(job, 'uploading');
        await sendMissingChunks(file, upload, (received) => {
            onBackOnline();
            showUploaded(job, received);
        }, onOffline, signal);
        addLog(`${jobName(job)}: workbook uploaded`, 'success', 'upload');
        return upload;
    }

    async function verify(job: Job, batch: UploadDetail): Promise<void> {
        setJobState(job, 'verifying');
        setProgress(job.view.validateBar, null);
        job.view.validateText.textContent = 'Verifying the file';
        await retryWhileOffline(() => completeUpload(batch.id, signal), onOffline, signal);
        onBackOnline();
        addLog(`${jobName(job)}: file verified, validation started`, 'info', 'shieldCheck');
    }

    /** Follows the batch's live events until validation finishes or fails. */
    function followValidation(job: Job, batch: UploadDetail): Promise<void> {
        setJobState(job, 'validating');
        setProgress(job.view.validateBar, null);
        job.view.validateText.textContent = 'Starting';
        const reviewHref = `#/batches/${encodeURIComponent(batch.id)}`;
        const stop = new AbortController();
        // Opens the batch's table in a new tab, where each row appears as it is checked. A new tab, because
        // leaving this page would stop the other workbooks.
        job.view.foot.hidden = false;
        job.view.watch.hidden = false;
        job.view.watch.href = reviewHref;
        slot(job.view.watch, 'watch-name').textContent = ` for ${jobName(job)}`;

        return new Promise((resolve) => {
            function finish(): void {
                stop.abort();
                job.view.watch.hidden = true;
                if (!jobs.some((other) => other.state === 'validating')) setConnection(null);
                resolve();
            }

            signal.addEventListener('abort', finish, {once: true, signal: stop.signal});
            watchUploadEvents(batch.id, {
                onConnection(state) {
                    setConnection(state);
                    if (state === 'reconnecting') addLog(`${jobName(job)}: live updates interrupted, reconnecting`, 'warning', 'wifiOff');
                },
                onEvent(type, payload) {
                    if (type === 'file_received') {
                        showUploaded(job, batch.chunkCount);
                    } else if (type === 'processing_started') {
                        job.totalRows = int(payload, 'total_rows');
                        showRowCounts(job);
                    } else if (type === 'row_processed') {
                        job.rows.set(int(payload, 'row_number'), text(payload, 'status'));
                        showRowCounts(job);
                    } else if (type === 'validation_completed') {
                        job.totalRows = int(payload, 'total_rows');
                        showRowCounts(job);
                        const rejected = int(payload, 'invalid_rows');
                        job.view.validateText.textContent = `${job.totalRows} rows checked`;
                        job.view.review.hidden = false;
                        job.view.review.href = reviewHref;
                        slot(job.view.review, 'review-name').textContent = ` for ${jobName(job)}`;
                        setJobState(job, rejected > 0 ? 'review' : 'validated');
                        addLog(`${jobName(job)}: validation complete, ${plural(rejected, 'row needs', 'rows need')} attention`, 'success', 'checkCircle');
                        finish();
                    } else if (type === 'failed') {
                        const missing = items(child(payload, 'details') ?? payload, 'missing_fields').map((item) => item.textContent ?? '');
                        const message = missing.length
                            ? `The workbook is missing these required columns: ${missing.join(', ')}. Download the template and copy the rows into it.`
                            : text(payload, 'message') || 'Validation stopped.';
                        // Stops the moving bar: nothing more will happen to this workbook.
                        setProgress(job.view.validateBar, 0);
                        job.view.validateText.textContent = 'Stopped';
                        setJobState(job, 'rejected', message);
                        addLog(`${jobName(job)}: workbook rejected`, 'danger', 'xCircle');
                        finish();
                    } else if (type === 'stream_end') {
                        finish();
                    }
                },
            }, AbortSignal.any([signal, stop.signal]));
        });
    }

    /** Takes one workbook from where it is now to the end of validation. A failure stays on its own panel. */
    async function runJob(job: Job): Promise<void> {
        try {
            let batch = job.batch;
            if (batch === null || needsFile(batch)) {
                const sent = await sendWorkbook(job, batch);
                if (!sent) return;
                batch = sent;
                await verify(job, batch);
            } else if (batch.status === 'uploaded') {
                await verify(job, batch);
            }
            await followValidation(job, batch);
        } catch (error) {
            if (signal.aborted) return;
            const {title: heading, detail} = describeError(error);
            setJobState(job, 'failed', `${heading}. ${detail}`);
            addLog(`${jobName(job)}: ${heading}`, 'danger', 'xCircle');
        }
    }

    /** Runs the workbooks with at most MAX_PARALLEL at a time; each worker takes the next waiting one. */
    async function runJobs(list: Job[]): Promise<void> {
        for (const job of list) setJobState(job, 'queued');
        const waiting = [...list];

        async function worker(): Promise<void> {
            while (waiting.length > 0 && !signal.aborted) {
                const job = waiting.shift();
                if (job) await runJob(job);
            }
        }

        const workers: Promise<void>[] = [];
        for (let index = 0; index < Math.min(MAX_PARALLEL, waiting.length); index += 1) workers.push(worker());
        await Promise.all(workers);
    }

    function showSummary(): void {
        const failed = jobs.filter((job) => job.state === 'failed').length;
        const rejected = jobs.filter((job) => job.state === 'rejected').length;
        const done = jobs.filter((job) => job.state === 'validated' || job.state === 'review');
        if (failed + rejected > 0) {
            const advice = failed > 0
                ? 'Check the message on each failed workbook, then retry it.'
                : 'Fix each rejected workbook, then upload it again as a new batch.';
            showNotice('danger', `${failed + rejected} of ${plural(jobs.length, 'workbook', 'workbooks')} did not finish`,
                `${advice} The other batches are not affected.`, {restart: true});
            return;
        }
        const only = done.length === 1 ? done[0] : undefined;
        showNotice('success', 'Validation complete',
            `${plural(done.length, 'batch is', 'batches are')} ready to review. No members are onboarded until you commit each batch.`,
            only?.batch
                ? {href: `#/batches/${encodeURIComponent(only.batch.id)}`, label: 'Review results', restart: true}
                : {href: '#/batches', label: 'Open batches', restart: true});
    }

    async function start(): Promise<void> {
        let list: Job[];
        if (started) {
            list = jobs.filter((job) => job.state === 'failed');
        } else {
            const formValid = form.validate();
            const jobsValid = validateJobs(formValid);
            if (!formValid || !jobsValid) return;
            list = jobs.filter((job) => job.state === 'ready');
        }
        started = true;
        running = true;
        form.setDisabled(true);
        for (const job of jobs) {
            job.view.name.readOnly = true;
            job.view.remove.hidden = true;
        }
        updateSubmit();
        showNotice('info', `Sending ${plural(list.length, 'workbook', 'workbooks')}`,
            `Keep this page open while the files are sent. Up to ${MAX_PARALLEL} are sent at a time; the rest wait in the list.`);
        await runJobs(list);
        running = false;
        if (signal.aborted) return;
        updateSubmit();
        showSummary();
    }

    formElement.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!running) void start();
    });
    window.addEventListener('beforeunload', (event) => {
        if (jobs.some((job) => BUSY_STATES.includes(job.state))) event.preventDefault();
    }, {signal});

    // Checksums and idempotency keys need crypto.subtle and crypto.randomUUID, which browsers only offer on https or localhost.
    if (!window.isSecureContext) {
        form.setDisabled(true);
        submit.disabled = true;
        showNotice('danger', 'Uploads need a secure address', 'Open the console on http://localhost or over https to upload a workbook.');
        return;
    }

    const resumeIds = query.getAll('resume');
    if (resumeIds.length === 0) return;

    resuming = true;
    title.textContent = resumeIds.length > 1 ? 'Resume batches' : 'Resume batch';
    subtitle.textContent = 'Choose the same workbooks again to send the parts that are missing. Parts already received are not sent again.';
    form.setDisabled(true);
    submit.disabled = true;
    const results = await Promise.allSettled(resumeIds.map((id) => getUpload(id, signal)));
    if (signal.aborted) return;

    for (const result of results) {
        if (result.status === 'rejected') continue;
        const batch = result.value;
        const job = addJob(null, batch);
        showUploaded(job, batch.uploadedChunks.length);
        if (needsFile(batch)) {
            job.view.nameHint.textContent = `Choose ${batch.fileName} (${formatBytes(batch.fileSize)}) again to continue.`;
            job.view.nameHint.hidden = false;
            setJobState(job, 'needsFile');
        } else {
            setJobState(job, 'ready');
        }
    }
    const missing = results.length - jobs.length;
    if (jobs.length === 0) {
        const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        const {title: heading, detail} = describeError(firstFailure?.reason);
        showNotice('danger', heading, detail, {restart: true});
        return;
    }
    if (missing > 0) {
        showNotice('warning', `${plural(missing, 'batch', 'batches')} could not be loaded`, 'The others are listed below.');
    }

    const first = jobs[0]!;
    form.setValue('description', first.batch?.description ?? '');
    form.setReadOnly('description', true);
    form.setHidden('workbooks', !jobs.some((job) => needsFile(job.batch)));

    // Batches already validating need nothing from the user, so they are followed straight away.
    const alreadyValidating = jobs.filter((job) => job.batch && !needsFile(job.batch) && job.batch.status !== 'uploaded');
    const needAction = jobs.filter((job) => !alreadyValidating.includes(job));
    if (needAction.length === 0) {
        started = true;
        updateSubmit();
        submit.hidden = true;
        await runJobs(alreadyValidating);
        if (!signal.aborted) showSummary();
        return;
    }
    form.setDisabled(false);
    updateSubmit();
    showNotice('info', 'Upload not finished', 'Choose the same workbooks to send the remaining parts, then resume.');
    if (alreadyValidating.length) void runJobs(alreadyValidating);
};

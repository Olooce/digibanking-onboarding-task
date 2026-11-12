import {describeError} from '../api/client.js';
import {downloadTemplate} from '../api/files.js';
import {completeUpload, createUpload, getUpload, type UploadDetail} from '../api/uploads.js';
import {child, int, items, text} from '../api/xml.js';
import {$, el, fromTemplate, replace, slot} from '../dom.js';
import {formatBytes} from '../format.js';
import {icon, type IconName, setIcon} from '../icons.js';
import type {Page} from '../router.js';
import {patchHashQuery} from '../router.js';
import {bindDownloadButton} from '../ui/downloadButton.js';
import {createFormFields, type FieldConfig} from '../ui/form.js';
import {watchUploadEvents} from '../upload/events.js';
import {retryWhileOffline} from '../upload/retry.js';
import {sha256Hex} from '../upload/sha256.js';
import {sendMissingChunks} from '../upload/transfer.js';

const BATCH_FIELDS: FieldConfig[] = [
    {
        name: 'batchName',
        label: 'Batch name',
        type: 'text',
        required: true,
        maxLength: 120,
        hint: 'Shown in the batch list, for example Riverside Branch - October Enrolment.',
    },
    {name: 'description', label: 'Description', type: 'textarea', maxLength: 1000, rows: 3},
    {
        name: 'workbook',
        label: 'Workbook',
        type: 'file',
        required: true,
        accept: '.xlsx',
        maxBytes: 50 * 1024 * 1024,
        hint: 'Up to 50 MB. Use the onboarding template.',
    },
];

type Tone = 'info' | 'success' | 'warning' | 'danger';
type Step = 'upload' | 'verify' | 'validate' | 'done';

const STEPS = ['upload', 'verify', 'validate'];
const TONE_ICON: Record<Tone, IconName> = {info: 'info', success: 'checkCircle', warning: 'wifiOff', danger: 'xCircle'};

/** The workbook still has to be sent while the batch is in one of these states. */
function needsFile(upload: UploadDetail | null): boolean {
    return upload === null || upload.status === 'created' || upload.status === 'uploading';
}

export const newBatchPage: Page = async ({outlet, query, signal}) => {
    const view = fromTemplate('tpl-new-batch');
    const title = slot(view, 'title');
    const subtitle = slot(view, 'subtitle');
    const formElement = slot<HTMLFormElement>(view, 'form');
    const submit = slot<HTMLButtonElement>(view, 'submit');
    const submitLabel = slot(view, 'submit-label');
    const notice = slot(view, 'notice');
    const noticeIcon = slot<SVGUseElement>(view, 'notice-icon');
    const noticeTitle = slot(view, 'notice-title');
    const noticeText = slot(view, 'notice-text');
    const noticeList = slot(view, 'notice-list');
    const reviewLink = slot<HTMLAnchorElement>(view, 'review');
    const restartLink = slot(view, 'restart');
    const connection = slot(view, 'connection');
    const uploadBar = slot(view, 'upload-bar');
    const uploadText = slot(view, 'upload-text');
    const validateBar = slot(view, 'validate-bar');
    const validateText = slot(view, 'validate-text');
    const validCount = slot(view, 'count-valid');
    const invalidCount = slot(view, 'count-invalid');
    const duplicateCount = slot(view, 'count-duplicate');
    const log = slot(view, 'log');

    const form = createFormFields('batch', BATCH_FIELDS);
    slot(view, 'fields').replaceWith(form.element);
    bindDownloadButton(slot<HTMLButtonElement>(view, 'template'), 'Template', downloadTemplate);
    outlet.append(view);

    let batch: UploadDetail | null = null;
    let uploading = false;
    let offline = false;

    function setStep(current: Step): void {
        const reached = current === 'done' ? STEPS.length : STEPS.indexOf(current);
        STEPS.forEach((step, index) => {
            const item = $(`[data-step="${step}"]`, outlet);
            item.toggleAttribute('data-done', index < reached);
            if (index === reached) item.setAttribute('aria-current', 'step');
            else item.removeAttribute('aria-current');
        });
    }

    function setBar(bar: HTMLElement, done: number, total: number): void {
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        bar.setAttribute('aria-valuenow', String(percent));
        bar.style.setProperty('--value', String(percent));
    }

    function showNotice(tone: Tone, heading: string, message: string, links: {
        review?: string;
        restart?: boolean
    } = {}): void {
        notice.hidden = false;
        notice.className = `alert alert--${tone}`;
        setIcon(noticeIcon, TONE_ICON[tone]);
        noticeTitle.textContent = heading;
        noticeText.textContent = message;
        noticeList.hidden = true;
        reviewLink.hidden = !links.review;
        reviewLink.href = links.review ?? '';
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

    function setLocked(locked: boolean): void {
        form.setDisabled(locked);
        submit.disabled = locked;
    }

    function onOffline(): void {
        if (!offline) addLog('Connection lost', 'warning', 'wifiOff');
        offline = true;
        setConnection('offline');
        showNotice('warning', 'Connection lost', 'Nothing has been lost. The upload carries on from the same point when the connection returns.');
    }

    function onBackOnline(message: string): void {
        if (!offline) return;
        offline = false;
        setConnection(null);
        addLog('Connection restored', 'success', 'refresh');
        showNotice('info', 'Connection restored', message);
    }

    function showPartsSent(received: number, total: number): void {
        setBar(uploadBar, received, total);
        uploadText.textContent = `${received} of ${total} parts`;
    }

    function followValidation(uploadId: string): void {
        setStep('validate');
        showNotice('info', 'Validating rows', 'Each row is checked against core banking. No members are onboarded during validation.');
        const reviewHref = `#/batches/${encodeURIComponent(uploadId)}`;
        // Keyed by row number, so a replayed event cannot be counted twice.
        const rowStatus = new Map<number, string>();
        let totalRows = 0;

        function showRowCounts(): void {
            const statuses = [...rowStatus.values()];
            validCount.textContent = String(statuses.filter((status) => status === 'valid').length);
            invalidCount.textContent = String(statuses.filter((status) => status === 'invalid').length);
            duplicateCount.textContent = String(statuses.filter((status) => status === 'duplicate').length);
            setBar(validateBar, rowStatus.size, totalRows);
            validateText.textContent = totalRows ? `${rowStatus.size} of ${totalRows} rows` : 'Starting';
        }

        watchUploadEvents(uploadId, {
            onConnection(state) {
                setConnection(state);
                if (state === 'reconnecting') addLog('Live updates interrupted, reconnecting', 'warning', 'wifiOff');
            },
            onEvent(type, payload) {
                if (type === 'file_received') {
                    setBar(uploadBar, 1, 1);
                    uploadText.textContent = 'Complete';
                } else if (type === 'processing_started') {
                    totalRows = int(payload, 'total_rows');
                    showRowCounts();
                } else if (type === 'row_processed') {
                    rowStatus.set(int(payload, 'row_number'), text(payload, 'status'));
                    showRowCounts();
                } else if (type === 'validation_completed') {
                    totalRows = int(payload, 'total_rows');
                    showRowCounts();
                    const rejected = int(payload, 'invalid_rows');
                    setStep('done');
                    setConnection(null);
                    addLog('Validation complete', 'success', 'checkCircle');
                    showNotice('success', 'Validation complete',
                        `${totalRows} rows checked: ${totalRows - rejected} valid and ${rejected} need attention. No members have been onboarded yet. Review the results, then commit the valid rows.`,
                        {review: reviewHref});
                } else if (type === 'failed') {
                    setConnection(null);
                    addLog('Validation failed', 'danger', 'xCircle');
                    showNotice('danger', 'The workbook could not be validated', text(payload, 'message') || 'Validation stopped.', {restart: true});
                    const missing = items(child(payload, 'details') ?? payload, 'missing_fields');
                    if (missing.length) {
                        noticeText.textContent = 'The workbook is missing these required columns. Download the template and copy the rows into it.';
                        replace(noticeList, missing.map((item) => el('li', {}, item.textContent ?? '')));
                        noticeList.hidden = false;
                    }
                } else if (type === 'commit_completed') {
                    showNotice('success', 'This batch has been committed', 'Open the batch to see which members were onboarded.', {review: reviewHref});
                }
            },
        }, signal);
    }

    async function sendWorkbook(file: File): Promise<UploadDetail | null> {
        setStep('upload');
        showNotice('info', 'Preparing the file', 'Calculating the file checksum.');
        const digest = await sha256Hex(file);
        let upload: UploadDetail;

        if (batch) {
            if (digest !== batch.fileSha256) {
                form.setError('workbook', `This is not the file this batch started with. Select ${batch.fileName} (${formatBytes(batch.fileSize)}).`);
                return null;
            }
            const id = batch.id;
            upload = await retryWhileOffline(() => getUpload(id, signal), onOffline, signal);
            addLog(`Resuming: ${upload.uploadedChunks.length} of ${upload.chunkCount} parts already received`, 'info', 'refresh');
        } else {
            const details = {
                batchName: form.getValue('batchName').trim(),
                description: form.getValue('description').trim(),
                fileName: file.name,
                fileSize: file.size,
                fileSha256: digest,
            };
            // The same key is reused if the request is retried, so the server never creates the batch twice.
            const idempotencyKey = crypto.randomUUID();
            upload = await retryWhileOffline(() => createUpload(details, idempotencyKey, signal), onOffline, signal);
            batch = upload;
            patchHashQuery({resume: upload.id});
            addLog('Batch created', 'info', 'layers');
        }

        showNotice('info', 'Uploading the workbook', 'Keep this page open while the file is sent.');
        await sendMissingChunks(file, upload, (received) => {
            onBackOnline('Uploading the rest of the workbook.');
            showPartsSent(received, upload.chunkCount);
        }, onOffline, signal);
        addLog('Workbook uploaded', 'success', 'upload');
        return upload;
    }

    async function start(): Promise<void> {
        if (!form.validate()) return;
        setLocked(true);
        uploading = true;
        try {
            const file = form.getFile('workbook');
            const upload = needsFile(batch) && file ? await sendWorkbook(file) : batch;
            if (!upload) {
                setLocked(false);
                uploading = false;
                form.focus('workbook');
                return;
            }
            setStep('verify');
            showNotice('info', 'Verifying the file', 'Checking that the assembled workbook matches the original.');
            await retryWhileOffline(() => completeUpload(upload.id, signal), onOffline, signal);
            onBackOnline('Validation is starting.');
            uploading = false;
            addLog('File verified, validation started', 'info', 'shieldCheck');
            followValidation(upload.id);
        } catch (error) {
            if (signal.aborted) return;
            uploading = false;
            setLocked(false);
            const {title: heading, detail} = describeError(error);
            showNotice('danger', heading, detail);
            addLog(heading, 'danger', 'xCircle');
            submitLabel.textContent = 'Try again';
        }
    }

    formElement.addEventListener('submit', (event) => {
        event.preventDefault();
        void start();
    });
    window.addEventListener('beforeunload', (event) => {
        if (uploading) event.preventDefault();
    }, {signal});

    // Checksums and idempotency keys need crypto.subtle and crypto.randomUUID, which browsers only offer on https or localhost.
    if (!window.isSecureContext) {
        setLocked(true);
        showNotice('danger', 'Uploads need a secure address', 'Open the console on http://localhost or over https to upload a workbook.');
        return;
    }

    const resumeId = query.get('resume');
    if (!resumeId) return;

    title.textContent = 'Resume batch';
    setLocked(true);
    try {
        batch = await getUpload(resumeId, signal);
    } catch (error) {
        if (signal.aborted) return;
        const {title: heading, detail} = describeError(error);
        showNotice('danger', heading, detail, {restart: true});
        return;
    }

    subtitle.textContent = `${batch.fileName} · ${formatBytes(batch.fileSize)}`;
    form.setValue('batchName', batch.batchName);
    form.setValue('description', batch.description);
    form.setReadOnly('batchName', true);
    form.setReadOnly('description', true);
    showPartsSent(batch.uploadedChunks.length, batch.chunkCount);

    if (needsFile(batch)) {
        form.setHint('workbook', `Select ${batch.fileName} (${formatBytes(batch.fileSize)}) again to continue.`);
        submitLabel.textContent = 'Resume upload';
        setStep('upload');
        showNotice('info', 'Upload not finished', 'Select the same workbook to send the remaining parts. Parts already received are not sent again.');
        setLocked(false);
    } else if (batch.status === 'uploaded') {
        form.setHidden('workbook', true);
        submitLabel.textContent = 'Start validation';
        setStep('verify');
        showNotice('info', 'Workbook received', 'Start validation to check each row.');
        setLocked(false);
    } else {
        form.setHidden('workbook', true);
        submit.hidden = true;
        followValidation(batch.id);
    }
};

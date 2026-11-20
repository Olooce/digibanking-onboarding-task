import {el} from '../dom.js';
import {formatBytes} from '../format.js';

export type FieldType = 'text' | 'textarea' | 'file' | 'checkbox';

/** Describes one form field. The form is rendered and validated from this list. */
export interface FieldConfig {
    name: string;
    label: string;
    type: FieldType;
    required?: boolean;
    maxLength?: number;
    hint?: string;
    rows?: number;
    /** File fields only: the accepted extension, for example ".xlsx". */
    accept?: string;
    /** File fields only: the largest allowed size in bytes. */
    maxBytes?: number;
    /** File fields only: allow several files. Each pick or drop adds to the files already chosen. */
    multiple?: boolean;
}

interface RenderedField {
    config: FieldConfig;
    wrapper: HTMLElement;
    control: HTMLInputElement | HTMLTextAreaElement;
    hint: HTMLElement;
    error: HTMLElement;
}

export interface FormFields {
    element: HTMLElement;

    getValue(name: string): string;

    getFile(name: string): File | null;

    /** Every file chosen in a file field, in the order they were added. */
    getFiles(name: string): File[];

    removeFile(name: string, file: File): void;

    /** Called whenever the chosen files of a file field change. */
    onFilesChange(name: string, listener: (files: File[]) => void): void;

    isChecked(name: string): boolean;

    setValue(name: string, value: string): void;

    setHint(name: string, text: string): void;

    setError(name: string, message: string | null): void;

    setReadOnly(name: string, readOnly: boolean): void;

    setHidden(name: string, hidden: boolean): void;

    setDisabled(disabled: boolean): void;

    focus(name: string): void;

    /** Checks every visible field, shows the errors and focuses the first invalid field. */
    validate(): boolean;
}

function requiredMark(config: FieldConfig): HTMLElement {
    return config.required
        ? el('span', {class: 'req', 'aria-hidden': 'true'}, ' *')
        : el('span', {class: 'muted'}, ' (optional)');
}

/** What is wrong with one chosen file, or null when it is acceptable. */
export function fileError(config: FieldConfig, file: File): string | null {
    if (config.accept && !file.name.toLowerCase().endsWith(config.accept)) return `Choose a ${config.accept} file.`;
    if (file.size === 0) return 'This file is empty.';
    if (config.maxBytes && file.size > config.maxBytes) return `The file must be ${formatBytes(config.maxBytes)} or smaller.`;
    return null;
}

function filesError(config: FieldConfig, files: File[]): string | null {
    if (files.length === 0) return config.required ? `Choose the ${config.label.toLowerCase()}.` : null;
    for (const file of files) {
        const problem = fileError(config, file);
        // With several files the message names the one that is wrong.
        if (problem) return files.length > 1 ? `${file.name}: ${problem}` : problem;
    }
    return null;
}

function textError(config: FieldConfig, value: string): string | null {
    if (config.required && value.trim() === '') return `Enter a ${config.label.toLowerCase()}.`;
    if (config.maxLength && value.length > config.maxLength) return `Use at most ${config.maxLength} characters.`;
    return null;
}

function renderCheckboxField(config: FieldConfig, id: string): RenderedField {
    const hint = el('p', {class: 'field__hint', id: `${id}-hint`, hidden: !config.hint}, config.hint ?? '');
    const error = el('p', {class: 'field__error', id: `${id}-error`, hidden: true});
    const control = el('input', {
        id,
        name: config.name,
        type: 'checkbox',
        required: config.required,
        'aria-describedby': `${id}-hint ${id}-error`
    });
    const wrapper = el('div', {class: 'field'}, [
        el('label', {class: 'check', for: id}, [control, el('span', {}, config.label)]),
        hint,
        error,
    ]);
    return {config, wrapper, control, hint, error};
}

function renderTextField(config: FieldConfig, id: string): RenderedField {
    const hint = el('p', {class: 'field__hint', id: `${id}-hint`}, config.hint ?? '');
    const error = el('p', {class: 'field__error', id: `${id}-error`, hidden: true});
    const attrs = {
        id,
        name: config.name,
        maxlength: config.maxLength,
        required: config.required,
        autocomplete: 'off',
        'aria-describedby': `${id}-hint ${id}-error`,
    };
    const control = config.type === 'textarea'
        ? el('textarea', {...attrs, class: 'textarea', rows: config.rows ?? 3})
        : el('input', {...attrs, class: 'input', type: 'text'});
    hint.hidden = !config.hint;
    const wrapper = el('div', {class: 'field'}, [
        el('label', {class: 'field__label', for: id}, [config.label, requiredMark(config)]),
        control,
        hint,
        error,
    ]);
    return {config, wrapper, control, hint, error};
}

function renderFileField(config: FieldConfig, id: string): RenderedField {
    const hint = el('span', {class: 'field__hint', id: `${id}-hint`}, config.hint ?? '');
    const error = el('p', {class: 'field__error', id: `${id}-error`, hidden: true});
    // The real file input is only visually hidden, so it stays in the tab order and opens the file picker
    // with Enter or Space by itself. The drop area shows its focus ring (see .dropzone in components.css).
    const control = el('input', {
        id,
        name: config.name,
        type: 'file',
        class: 'sr-only dropzone__input',
        accept: config.accept,
        multiple: config.multiple,
        'aria-labelledby': `${id}-label`,
        'aria-describedby': `${id}-hint ${id}-error`,
    });
    // The visible drop area is a <label> for the input, so clicking it opens the file picker.
    const dropzone = el('label', {class: 'dropzone', for: id}, [
        el('strong', {}, config.multiple ? `Choose ${config.accept ?? ''} files` : `Choose a ${config.accept ?? ''} file`),
        el('span', {}, config.multiple ? 'or drop them here' : 'or drop it here'),
        hint,
    ]);

    dropzone.addEventListener('dragover', (event) => {
        event.preventDefault();
        dropzone.setAttribute('data-over', '');
    });
    dropzone.addEventListener('dragleave', () => dropzone.removeAttribute('data-over'));
    dropzone.addEventListener('drop', (event) => {
        event.preventDefault();
        dropzone.removeAttribute('data-over');
        if (control.disabled || !event.dataTransfer?.files.length) return;
        control.files = event.dataTransfer.files;
        control.dispatchEvent(new Event('change'));
    });

    const wrapper = el('div', {class: 'field'}, [
        el('span', {class: 'field__label', id: `${id}-label`}, [config.label, requiredMark(config)]),
        control,
        dropzone,
        error,
    ]);
    return {config, wrapper, control, hint, error};
}

/** True when two File objects are the same file picked twice. */
function sameFile(a: File, b: File): boolean {
    return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

export function createFormFields(idPrefix: string, configs: FieldConfig[]): FormFields {
    const fields = new Map<string, RenderedField>();
    for (const config of configs) {
        const id = `${idPrefix}-${config.name}`;
        if (config.type === 'file') fields.set(config.name, renderFileField(config, id));
        else if (config.type === 'checkbox') fields.set(config.name, renderCheckboxField(config, id));
        else fields.set(config.name, renderTextField(config, id));
    }
    const element = el('div', {class: 'stack'}, [...fields.values()].map((field) => field.wrapper));

    // Files chosen in each file field. They are kept here rather than in the input, because the input
    // forgets earlier picks every time the picker opens.
    const chosenFiles = new Map<string, File[]>();
    const fileListeners = new Map<string, ((files: File[]) => void)[]>();

    function field(name: string): RenderedField {
        const found = fields.get(name);
        if (!found) throw new Error(`Unknown form field: ${name}`);
        return found;
    }

    function setError(name: string, message: string | null): void {
        const {control, error} = field(name);
        error.hidden = !message;
        error.textContent = message ?? '';
        control.setAttribute('aria-invalid', String(Boolean(message)));
    }

    function getFiles(name: string): File[] {
        return chosenFiles.get(name) ?? [];
    }

    function setFiles(name: string, files: File[]): void {
        chosenFiles.set(name, files);
        setError(name, null);
        for (const listener of fileListeners.get(name) ?? []) listener(files);
    }

    function isChecked(name: string): boolean {
        const {control} = field(name);
        return control instanceof HTMLInputElement && control.checked;
    }

    for (const {config, control, hint} of fields.values()) {
        if (config.type === 'text' || config.type === 'textarea') {
            control.addEventListener('input', () => setError(config.name, null));
        } else if (config.type === 'checkbox') {
            control.addEventListener('change', () => setError(config.name, null));
        } else if (control instanceof HTMLInputElement) {
            control.addEventListener('change', () => {
                const picked = [...(control.files ?? [])];
                // Cleared so that picking the same file again, for example after removing it, still fires change.
                control.value = '';
                if (picked.length === 0) return;
                if (!config.multiple) {
                    const file = picked[0]!;
                    hint.textContent = `${file.name} · ${formatBytes(file.size)}`;
                    setFiles(config.name, [file]);
                    return;
                }
                const earlier = getFiles(config.name);
                const added = picked.filter((file) => !earlier.some((known) => sameFile(known, file)));
                setFiles(config.name, [...earlier, ...added]);
            });
        }
    }

    return {
        element,
        getValue: (name) => field(name).control.value,
        getFile: (name) => getFiles(name)[0] ?? null,
        getFiles,
        removeFile(name, file) {
            setFiles(name, getFiles(name).filter((chosen) => chosen !== file));
        },
        onFilesChange(name, listener) {
            fileListeners.set(name, [...(fileListeners.get(name) ?? []), listener]);
        },
        isChecked,
        setValue(name, value) {
            field(name).control.value = value;
        },
        setHint(name, text) {
            const {hint} = field(name);
            hint.textContent = text;
            hint.hidden = !text;
        },
        setError,
        setReadOnly(name, readOnly) {
            field(name).control.readOnly = readOnly;
        },
        setHidden(name, hidden) {
            field(name).wrapper.hidden = hidden;
        },
        setDisabled(disabled) {
            for (const {control} of fields.values()) control.disabled = disabled;
        },
        focus(name) {
            field(name).control.focus();
        },
        validate() {
            let firstInvalid: RenderedField | null = null;
            for (const current of fields.values()) {
                if (current.wrapper.hidden) continue;
                const {config} = current;
                let message: string | null;
                if (config.type === 'file') message = filesError(config, getFiles(config.name));
                else if (config.type === 'checkbox') message = config.required && !isChecked(config.name) ? 'Confirm this to continue.' : null;
                else message = textError(config, current.control.value);
                setError(config.name, message);
                if (message && !firstInvalid) firstInvalid = current;
            }
            firstInvalid?.control.focus();
            return firstInvalid === null;
        },
    };
}

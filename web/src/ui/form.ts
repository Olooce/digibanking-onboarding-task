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
}

interface RenderedField {
    config: FieldConfig;
    wrapper: HTMLElement;
    control: HTMLInputElement | HTMLTextAreaElement;
    hint: HTMLElement;
    error: HTMLElement;
    focusTarget: HTMLElement;
}

export interface FormFields {
    element: HTMLFieldSetElement;

    getValue(name: string): string;

    getFile(name: string): File | null;

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

function fileError(config: FieldConfig, file: File | null): string | null {
    if (!file) return config.required ? `Choose the ${config.label.toLowerCase()}.` : null;
    if (config.accept && !file.name.toLowerCase().endsWith(config.accept)) return `Choose a ${config.accept} file.`;
    if (file.size === 0) return 'This file is empty.';
    if (config.maxBytes && file.size > config.maxBytes) return `The file must be ${formatBytes(config.maxBytes)} or smaller.`;
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
    return {config, wrapper, control, hint, error, focusTarget: control};
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
    return {config, wrapper, control, hint, error, focusTarget: control};
}

function renderFileField(config: FieldConfig, id: string): RenderedField {
    const hint = el('span', {class: 'field__hint', id: `${id}-hint`}, config.hint ?? '');
    const error = el('p', {class: 'field__error', id: `${id}-error`, hidden: true});
    const control = el('input', {
        id,
        name: config.name,
        type: 'file',
        class: 'sr-only',
        tabindex: '-1',
        accept: config.accept,
        'aria-labelledby': `${id}-label`,
        'aria-describedby': `${id}-error`,
    });
    // The visible drop area is a <label> for the hidden input, so clicking it opens the file picker.
    const dropzone = el('label', {
        class: 'dropzone',
        for: id,
        tabindex: '0',
        'aria-describedby': `${id}-hint ${id}-error`
    }, [
        el('strong', {}, `Choose a ${config.accept ?? ''} file`),
        el('span', {}, 'or drop it here'),
        hint,
    ]);

    dropzone.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        control.click();
    });
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
    control.addEventListener('change', () => {
        const file = control.files?.[0];
        if (file) hint.textContent = `${file.name} · ${formatBytes(file.size)}`;
    });

    const wrapper = el('div', {class: 'field'}, [
        el('span', {class: 'field__label', id: `${id}-label`}, [config.label, requiredMark(config)]),
        dropzone,
        control,
        error,
    ]);
    return {config, wrapper, control, hint, error, focusTarget: dropzone};
}

export function createFormFields(idPrefix: string, configs: FieldConfig[]): FormFields {
    const fields = new Map<string, RenderedField>();
    for (const config of configs) {
        const id = `${idPrefix}-${config.name}`;
        if (config.type === 'file') fields.set(config.name, renderFileField(config, id));
        else if (config.type === 'checkbox') fields.set(config.name, renderCheckboxField(config, id));
        else fields.set(config.name, renderTextField(config, id));
    }
    const element = el('fieldset', {class: 'stack'}, [...fields.values()].map((field) => field.wrapper));

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

    function getFile(name: string): File | null {
        const {control} = field(name);
        return control instanceof HTMLInputElement ? control.files?.[0] ?? null : null;
    }

    function isChecked(name: string): boolean {
        const {control} = field(name);
        return control instanceof HTMLInputElement && control.checked;
    }

    for (const {config, control} of fields.values()) {
        const event = config.type === 'text' || config.type === 'textarea' ? 'input' : 'change';
        control.addEventListener(event, () => setError(config.name, null));
    }

    return {
        element,
        getValue: (name) => field(name).control.value,
        getFile,
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
            element.disabled = disabled;
        },
        focus(name) {
            field(name).focusTarget.focus();
        },
        validate() {
            let firstInvalid: RenderedField | null = null;
            for (const current of fields.values()) {
                if (current.wrapper.hidden) continue;
                let message: string | null;
                if (current.config.type === 'file') message = fileError(current.config, getFile(current.config.name));
                else if (current.config.type === 'checkbox') message = current.config.required && !isChecked(current.config.name) ? 'Confirm this to continue.' : null;
                else message = textError(current.config, current.control.value);
                setError(current.config.name, message);
                if (message && !firstInvalid) firstInvalid = current;
            }
            firstInvalid?.focusTarget.focus();
            return firstInvalid === null;
        },
    };
}

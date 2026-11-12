import {describeError} from '../api/client.js';
import {type CoreMember, findCoreMember, getMember, type Member} from '../api/members.js';
import {getUpload} from '../api/uploads.js';
import {el, fromTemplate, replace, slot} from '../dom.js';
import {formatDateTime} from '../format.js';
import {icon} from '../icons.js';
import type {Page} from '../router.js';
import type {Shell} from '../shell.js';

/** The fields shown for a member and compared with core banking. */
const MEMBER_FIELDS: { label: string; value: (member: Member | CoreMember) => string }[] = [
    {label: 'First name', value: (m) => m.firstName},
    {label: 'Last name', value: (m) => m.lastName},
    {label: 'Date of birth', value: (m) => m.dateOfBirth},
    {label: 'Email', value: (m) => m.email},
    {label: 'Phone', value: (m) => m.phoneNumber},
    {label: 'Member no.', value: (m) => m.memberNumber},
    {label: 'ID no.', value: (m) => m.idNumber},
    {label: 'Account no.', value: (m) => m.accountNumber},
    {label: 'Account type', value: (m) => m.accountType},
    {label: 'Branch', value: (m) => m.branch},
];

function showLoadError(outlet: HTMLElement, error: unknown): void {
    const {title, detail} = describeError(error);
    const view = fromTemplate('tpl-load-error');
    slot(view, 'title').textContent = title;
    slot(view, 'message').textContent = detail;
    outlet.append(view);
}

export function memberDetailPage(shell: Shell): Page {
    return async ({outlet, params, signal}) => {
        let member: Member;
        try {
            member = await getMember(params.id ?? '', signal);
        } catch (error) {
            if (!signal.aborted) showLoadError(outlet, error);
            return;
        }

        const view = fromTemplate('tpl-member');
        const name = `${member.firstName} ${member.lastName}`;
        shell.setPageLabel(name);
        slot(view, 'name').textContent = name;
        slot(view, 'onboarded').textContent = `Onboarded ${formatDateTime(member.onboardedAt)}`;
        replace(slot(view, 'details'), MEMBER_FIELDS.flatMap((field) => [el('dt', {}, field.label), el('dd', {}, field.value(member) || '-')]));

        const batchLink = slot<HTMLAnchorElement>(view, 'batch');
        batchLink.href = `#/batches/${encodeURIComponent(member.sourceUploadId)}`;
        getUpload(member.sourceUploadId, signal).then((batch) => {
            batchLink.textContent = batch.batchName;
        }).catch(() => {
            // The link still works with its default text.
        });

        const checkButton = slot<HTMLButtonElement>(view, 'check');
        const result = slot(view, 'result');
        checkButton.addEventListener('click', async () => {
            checkButton.disabled = true;
            checkButton.setAttribute('aria-busy', 'true');
            try {
                const core = await findCoreMember('member_number', member.memberNumber, signal);
                if (!core) {
                    replace(result, el('p', {
                        class: 'alert alert--warning',
                        role: 'status'
                    }, 'Core banking has no member with this member number.'));
                    return;
                }
                const rows = MEMBER_FIELDS.map((field) => {
                    const matches = field.value(member) === field.value(core);
                    return el('tr', {}, [
                        el('th', {scope: 'row'}, field.label),
                        el('td', {}, field.value(core) || '-'),
                        el('td', {class: matches ? 'text-success' : 'text-danger'}, [icon(matches ? 'check' : 'x', 'sm'), matches ? ' Matches' : ' Differs']),
                    ]);
                });
                replace(result, [
                    el('p', {
                        class: 'muted',
                        role: 'status'
                    }, `Core banking account status: ${core.status || 'unknown'}.`),
                    el('table', {class: 'compare'}, [
                        el('thead', {}, el('tr', {}, ['Field', 'Core banking', 'Result'].map((label) => el('th', {scope: 'col'}, label)))),
                        el('tbody', {}, rows),
                    ]),
                ]);
            } catch (error) {
                if (signal.aborted) return;
                const {title, detail} = describeError(error);
                replace(result, el('p', {class: 'alert alert--danger', role: 'alert'}, `${title}. ${detail}`));
            } finally {
                checkButton.disabled = false;
                checkButton.removeAttribute('aria-busy');
            }
        });

        outlet.append(view);
    };
}

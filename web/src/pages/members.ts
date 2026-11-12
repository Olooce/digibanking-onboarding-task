import {describeError} from '../api/client.js';
import {DATE_FILTER, ENUM_FILTER, type ListSchema, TEXT_FILTER, toODataParams} from '../api/odata.js';
import {listMembers, type Member} from '../api/members.js';
import {el, fromTemplate, slot} from '../dom.js';
import {formatDateTime} from '../format.js';
import type {Page} from '../router.js';
import {patchHashQuery} from '../router.js';
import type {Shell} from '../shell.js';
import {type ColumnConfig, createDataTable, type Query} from '../ui/dataTable.js';

const ACCOUNT_TYPES = [
    {value: 'personal', label: 'Personal'},
    {value: 'business', label: 'Business'},
    {value: 'joint', label: 'Joint'},
];

const MEMBER_COLUMNS: ColumnConfig<Member>[] = [
    {
        key: 'last_name',
        label: 'Name',
        ...TEXT_FILTER,
        hideable: false,
        accessor: (row) => `${row.firstName} ${row.lastName}`,
        render: (row) => el('a', {
            class: 'dt-link',
            href: `#/members/${encodeURIComponent(row.id)}`
        }, `${row.firstName} ${row.lastName}`),
    },
    {key: 'member_number', label: 'Member no.', ...TEXT_FILTER, accessor: (row) => row.memberNumber},
    {key: 'account_number', label: 'Account no.', ...TEXT_FILTER, accessor: (row) => row.accountNumber},
    {key: 'phone_number', label: 'Phone', ...TEXT_FILTER, accessor: (row) => row.phoneNumber},
    {key: 'id_number', label: 'ID no.', ...TEXT_FILTER, accessor: (row) => row.idNumber},
    {key: 'branch', label: 'Branch', ...TEXT_FILTER, accessor: (row) => row.branch},
    {
        key: 'account_type',
        label: 'Account type', ...ENUM_FILTER,
        options: ACCOUNT_TYPES,
        accessor: (row) => row.accountType
    },
    {key: 'email', label: 'Email', ...TEXT_FILTER, hidden: true, accessor: (row) => row.email},
    {key: 'date_of_birth', label: 'Date of birth', ...TEXT_FILTER, hidden: true, accessor: (row) => row.dateOfBirth},
    {
        key: 'created_at',
        label: 'Onboarded', ...DATE_FILTER,
        accessor: (row) => row.onboardedAt,
        render: (row) => formatDateTime(row.onboardedAt)
    },
];

const MEMBER_SCHEMA: ListSchema = {
    searchParam: 'search',
    searchFields: ['first_name', 'last_name', 'member_number', 'phone_number', 'id_number', 'email'],
    dateFields: ['created_at'],
};

export function membersPage(shell: Shell): Page {
    return ({outlet, query}) => {
        const view = fromTemplate('tpl-members');
        const host = slot(view, 'table');
        outlet.append(view);

        async function load(tableQuery: Query): Promise<{ rows: Member[]; total: number }> {
            try {
                const page = await listMembers(toODataParams(tableQuery, MEMBER_SCHEMA), tableQuery.signal);
                if (!tableQuery.quick && !tableQuery.filters.length) shell.setNavCount('members', page.total);
                return page;
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') throw error;
                throw new Error(describeError(error).detail);
            }
        }

        // No persistKey: saved filters could keep member names or ID numbers in the browser.
        const table = createDataTable<Member>({
            container: host,
            label: 'Onboarded members',
            columns: MEMBER_COLUMNS,
            data: load,
            rowId: (row) => row.id,
            pageSizes: [10, 20, 50, 100],
            pageSize: 20,
            sorts: [{field: 'created_at', dir: 'desc'}],
            emptyMessage: 'No members have been onboarded yet. Members appear here once a batch is committed.',
            onStateChange: ({quick}) => {
                const search = quick && quick.field === '' && quick.op === 'contains' ? quick.value : null;
                patchHashQuery({search});
            },
        });

        const search = query.get('search')?.trim();
        if (search) table.setState({quick: {field: '', op: 'contains', value: search, value2: ''}});
        return () => table.destroy();
    };
}

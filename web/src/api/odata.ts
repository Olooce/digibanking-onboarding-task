import type {Condition, Query} from '../ui/dataTable.js';

/** A quoted OData string; embedded quotes are doubled. */
export function literal(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

export function anyOf(expressions: string[]): string {
    return expressions.join(' or ');
}

function join(expressions: (string | null)[], joiner: 'and' | 'or'): string | null {
    const parts = expressions.filter((part): part is string => Boolean(part));
    if (parts.length <= 1) return parts[0] ?? null;
    return parts.map((part) => `(${part})`).join(` ${joiner} `);
}

/** Instant at which a local calendar day starts; the API stores UTC timestamps. */
function dayStart(value: string, offsetDays = 0): string {
    const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
    return literal(new Date(year, month - 1, day + offsetDays).toISOString());
}

function dateExpr({field, op, value, value2}: Condition): string {
    const from = `${field} ge ${dayStart(value)}`;
    const until = `${field} lt ${dayStart(value, 1)}`;
    switch (op) {
        case 'eq': return `${from} and ${until}`;
        case 'neq': return `not (${from} and ${until})`;
        case 'gt': return `${field} ge ${dayStart(value, 1)}`;
        case 'gte': return from;
        case 'lt': return `${field} lt ${dayStart(value)}`;
        case 'lte': return until;
        default: return `${from} and ${field} lt ${dayStart(value2, 1)}`;
    }
}

const COMPARISON: Record<string, string> = {eq: 'eq', neq: 'ne', gt: 'gt', gte: 'ge', lt: 'lt', lte: 'le'};
const FUNCTION: Record<string, string> = {contains: 'contains', startsWith: 'startswith', endsWith: 'endswith'};

function valueExpr(field: string, op: string, value: string, numeric: boolean): string {
    const operand = numeric ? String(Number(value)) : literal(value);
    if (op === 'notContains') return `not contains(${field},${operand})`;
    const fn = FUNCTION[op];
    return fn ? `${fn}(${field},${operand})` : `${field} ${COMPARISON[op] ?? 'eq'} ${operand}`;
}

export interface ListSchema {
    /** Fields behind the table's "Any text column" search. */
    searchFields: string[];
    numberFields?: string[];
    dateFields?: string[];
}

function conditionExpr(condition: Condition, schema: ListSchema): string {
    const {field, op, value, value2} = condition;
    if (field === '') return anyOf(schema.searchFields.map((name) => valueExpr(name, op, value, false)));
    if (schema.dateFields?.includes(field)) return dateExpr(condition);
    if (op === 'between') return `${field} ge ${Number(value)} and ${field} le ${Number(value2)}`;
    return valueExpr(field, op, value, schema.numberFields?.includes(field) ?? false);
}

/** Translates the table's query into the API's OData-style list parameters. */
export function toODataParams(query: Query, schema: ListSchema, scope: string | null = null): URLSearchParams {
    const params = new URLSearchParams();
    const conditions = join(query.filters.map((item) => conditionExpr(item, schema)), query.match === 'any' ? 'or' : 'and');
    const filter = join([scope, query.quick ? conditionExpr(query.quick, schema) : null, conditions], 'and');
    if (filter) params.set('$filter', filter);
    if (query.sorts.length) params.set('$orderby', query.sorts.map(({field, dir}) => `${field} ${dir}`).join(','));
    params.set('$top', String(query.pageSize));
    params.set('$skip', String((query.page - 1) * query.pageSize));
    params.set('$count', 'true');
    return params;
}

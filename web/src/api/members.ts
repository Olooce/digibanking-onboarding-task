import {requestXml, withQuery} from './client.js';
import type {ListPage} from './uploads.js';
import {child, int, items, text} from './xml.js';

export interface Member {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    email: string;
    branch: string;
    accountType: string;
    accountNumber: string;
    memberNumber: string;
    phoneNumber: string;
    idNumber: string;
    /** The batch the member was onboarded from. */
    sourceUploadId: string;
    onboardedAt: string;
}

/** A member as held by the simulated core banking system. */
export interface CoreMember {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    email: string;
    branch: string;
    accountType: string;
    accountNumber: string;
    memberNumber: string;
    phoneNumber: string;
    idNumber: string;
    status: string;
}

function toCoreMember(node: Element): CoreMember {
    return {
        firstName: text(node, 'first_name'),
        lastName: text(node, 'last_name'),
        dateOfBirth: text(node, 'date_of_birth'),
        email: text(node, 'email'),
        branch: text(node, 'branch'),
        accountType: text(node, 'account_type'),
        accountNumber: text(node, 'account_number'),
        memberNumber: text(node, 'member_number'),
        phoneNumber: text(node, 'phone_number'),
        idNumber: text(node, 'id_number'),
        status: text(node, 'status'),
    };
}

function toMember(node: Element): Member {
    return {
        ...toCoreMember(node),
        id: text(node, 'id'),
        sourceUploadId: text(node, 'source_upload_id'),
        onboardedAt: text(node, 'created_at'),
    };
}

export async function listMembers(query: URLSearchParams, signal?: AbortSignal): Promise<ListPage<Member>> {
    const root = await requestXml(withQuery('/members', query), {signal});
    const pagination = child(root, 'pagination');
    return {
        rows: items(root, 'data').map(toMember),
        total: pagination ? int(pagination, 'total') : 0,
    };
}

export async function getMember(id: string, signal?: AbortSignal): Promise<Member> {
    const root = await requestXml(`/members/${encodeURIComponent(id)}`, {signal});
    const node = child(root, 'member');
    if (!node) throw new Error('The response did not include the member.');
    return toMember(node);
}

export type CoreIdentifier = 'member_number' | 'phone_number' | 'id_number';

/** Looks a member up in core banking by exactly one identifier. Returns null when there is no match. */
export async function findCoreMember(identifier: CoreIdentifier, value: string, signal?: AbortSignal): Promise<CoreMember | null> {
    const root = await requestXml(withQuery('/core-banking/members', new URLSearchParams({[identifier]: value})), {signal});
    const node = child(root, 'member');
    return text(root, 'found') === 'true' && node ? toCoreMember(node) : null;
}

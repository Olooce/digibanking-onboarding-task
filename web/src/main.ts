import {fromTemplate} from './dom.js';
import {batchDetailPage} from './pages/batchDetail.js';
import {batchesPage} from './pages/batches.js';
import {memberDetailPage} from './pages/memberDetail.js';
import {membersPage} from './pages/members.js';
import {newBatchPage} from './pages/newBatch.js';
import {templatePage} from './pages/template.js';
import {createRouter, type Page} from './router.js';
import {bindShell, type Crumb, type NavKey} from './shell.js';

const shell = bindShell();

const HOME: Crumb = {label: 'Workspace', href: '#/batches'};
const BATCHES: Crumb = {label: 'Upload batches', href: '#/batches'};
const MEMBERS: Crumb = {label: 'Onboarded members', href: '#/members'};

/** Sets nav highlight and breadcrumb before delegating to the page. */
function view(nav: NavKey | null, crumbs: Crumb[] | ((params: Record<string, string>) => Crumb[]), page: Page): Page {
    return (ctx) => {
        shell.setActive(nav);
        shell.setBreadcrumb(typeof crumbs === 'function' ? crumbs(ctx.params) : crumbs);
        return page(ctx);
    };
}

const notFound: Page = ({outlet}) => {
    shell.setActive(null);
    shell.setBreadcrumb([HOME, {label: 'Not found'}]);
    outlet.append(fromTemplate('tpl-not-found'));
};

const router = createRouter([
    {path: '/', page: () => router.navigate('/batches', {replace: true})},
    {path: '/batches', page: view('batches', [HOME, {label: 'Upload batches'}], batchesPage(shell))},
    {path: '/batches/new', page: view('batches', [HOME, BATCHES, {label: 'New batch'}], newBatchPage)},
    {path: '/batches/:id', page: view('batches', [HOME, BATCHES, {label: 'Batch'}], batchDetailPage(shell))},
    {path: '/members', page: view('members', [HOME, {label: 'Onboarded members'}], membersPage(shell))},
    {path: '/members/:id', page: view('members', [HOME, MEMBERS, {label: 'Member'}], memberDetailPage(shell))},
    {path: '/template', page: view('template', [HOME, {label: 'Workbook template'}], templatePage)},
], shell.outlet, {
    fallback: notFound,
    onRoute: () => {
        shell.closeNav();
        shell.outlet.scrollTop = 0;
    },
});

router.start();

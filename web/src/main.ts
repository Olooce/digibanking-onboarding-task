import {fromTemplate} from './dom.js';
import {batchesPage} from './pages/batches.js';
import {pendingPage} from './pages/pending.js';
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
    {path: '/batches/new', page: view('batches', [HOME, BATCHES, {label: 'New batch'}], pendingPage('New batch', 'Name the batch, then upload the completed workbook.'))},
    {path: '/batches/:id', page: view('batches', [HOME, BATCHES, {label: 'Batch'}], pendingPage('Batch', 'Validation results and commit.'))},
    {path: '/members', page: view('members', [HOME, {label: 'Onboarded members'}], pendingPage('Onboarded members', 'Members whose onboarding has been confirmed.'))},
    {path: '/members/:id', page: view('members', [HOME, MEMBERS, {label: 'Member'}], pendingPage('Member', 'Member details.'))},
    {path: '/template', page: view('template', [HOME, {label: 'Workbook template'}], pendingPage('Workbook template', 'Download the blank XLSX template.'))},
], shell.outlet, {fallback: notFound, onRoute: () => shell.closeNav()});

router.start();

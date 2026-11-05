import {cpSync, mkdirSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

export const DIST_DIR = at('dist');
export const SOURCES = {
    index: at('index.html'),
    public: at('public'),
    styles: at('src/styles'),
};

export function assemble({clean = false} = {}) {
    if (clean) rmSync(DIST_DIR, {recursive: true, force: true});
    mkdirSync(at('dist/assets/css'), {recursive: true});
    cpSync(SOURCES.index, at('dist/index.html'));
    cpSync(SOURCES.public, DIST_DIR, {recursive: true});
    cpSync(SOURCES.styles, at('dist/assets/css'), {recursive: true});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    assemble({clean: process.argv.includes('--clean')});
    console.log('[assemble] index.html, public/ and src/styles/ copied to dist/');
}

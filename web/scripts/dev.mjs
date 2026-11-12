// Development loop: generate env, assemble dist/, run tsc --watch, re-assemble on static changes, serve dist/.
import {spawn, spawnSync} from 'node:child_process';
import {watch} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assemble, SOURCES} from './assemble.mjs';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const tscBin = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));

if (spawnSync(process.execPath, ['scripts/env.mjs'], {cwd: webDir, stdio: 'inherit'}).status !== 0) process.exit(1);
assemble({clean: true});

const children = [
    spawn(process.execPath, [tscBin, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'], {
        cwd: webDir,
        stdio: 'inherit'
    }),
    spawn(process.execPath, ['scripts/serve.mjs'], {cwd: webDir, stdio: 'inherit'}),
];

let timer = null;
const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
        assemble();
        console.log('[assemble] static change copied to dist/');
    }, 100);
};
watch(SOURCES.index, onChange);
watch(SOURCES.public, {recursive: true}, onChange);
watch(SOURCES.styles, {recursive: true}, onChange);

const stop = () => {
    for (const child of children) child.kill();
    process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

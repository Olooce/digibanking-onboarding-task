/**
 * Shows `done` of `total` on a native <progress> bar. Pass null for `done` while the total is not known
 * yet: without a value attribute the bar is indeterminate and slides back and forth.
 */
export function setProgress(bar: HTMLProgressElement, done: number | null, total = 1): void {
    if (done === null) {
        bar.removeAttribute('value');
        return;
    }
    bar.max = Math.max(total, 1);
    bar.value = Math.min(done, bar.max);
}

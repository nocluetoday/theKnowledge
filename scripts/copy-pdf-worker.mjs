/**
 * Copy pdf.js's prebuilt ES-module worker into `public/` so WXT ships it
 * verbatim.
 *
 * Bundling the worker through Vite is not an option here: WXT builds the
 * background entrypoint as an IIFE with a trailing global reference, and that
 * footer leaks into every chunk in the same build — including the worker, which
 * then dies with `ReferenceError: background is not defined` the moment pdf.js
 * loads it as a module worker.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs');
const destination = join(root, 'public', 'pdf.worker.mjs');

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);

console.log('Copied pdf.worker.mjs into public/');

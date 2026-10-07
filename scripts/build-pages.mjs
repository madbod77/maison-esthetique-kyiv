import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
for (const name of ['index.html', 'maison-preview.html']) {
  const file = path.join(dist, name);
  const html = await readFile(file, 'utf8');
  if(!html.includes('name="maison-leads-mode"'))await writeFile(file, html.replace('</head>', '  <meta name="maison-leads-mode" content="static">\n</head>'));
}
// Only the browser catalog belongs in the public hosting bundle.
for (const name of await readdir(path.join(dist, 'data'))) {
  if (name !== 'catalog.js') await rm(path.join(dist, 'data', name));
}
await writeFile(path.join(dist, '.nojekyll'), '');
console.log('Built static bundle with original Altegio links; leads require the included Node server.');

import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const catalog = JSON.parse(await readFile(path.join(root,'data/catalog.json'),'utf8'));
await writeFile(path.join(root,'data/catalog.js'),`window.MAISON_CATALOG=${JSON.stringify(catalog)};\n`);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ['index.html','styles.css','app.js','booking.js','booking-model.js','assets','data']) await cp(path.join(root,name), path.join(dist,name),{recursive:true});
let html = await readFile(path.join(root,'index.html'),'utf8');
const mime = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml'};
const dataURL = async p => `data:${mime[path.extname(p)]};base64,${(await readFile(path.join(root,p))).toString('base64')}`;
let css=await readFile(path.join(root,'styles.css'),'utf8');
for (const m of [...css.matchAll(/url\(['"]?(assets\/[^)'"\s]+)['"]?\)/g)]) css=css.replaceAll(m[0],`url('${await dataURL(m[1])}')`);
html=html.replace(/<link\b[^>]*href=["']styles\.css["'][^>]*>/,`<style>${css}</style>`);
let inlineScripts='';
for (const src of ['data/catalog.js','booking-model.js','booking.js','app.js']) {
  html=html.replace(new RegExp(`<script\\b[^>]*src=["']${src.replaceAll('.','\\.')}["'][^>]*><\\/script>`),'');
  inlineScripts+=`<script>${(await readFile(path.join(root,src),'utf8')).replaceAll('</script','<\\/script')}</script>`;
}
// Inline scripts must run after DOM creation; defer does not apply to inline scripts.
html=html.replace('</body>',`${inlineScripts}</body>`);
for (const m of [...html.matchAll(/(?:src|href)=["'](assets\/[^"']+)["']/g)]) html=html.replaceAll(m[1],await dataURL(m[1]));
// Inline any images referenced by application strings.
for(const name of await readdir(path.join(root,'assets'))) { const p=`assets/${name}`; if(mime[path.extname(name)]&&html.includes(p)) html=html.replaceAll(p,await dataURL(p)); }
await writeFile(path.join(dist,'maison-preview.html'),html);
console.log(`Built standalone ${Buffer.byteLength(html)} bytes and static folder ${dist}`);

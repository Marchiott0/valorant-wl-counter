import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let checked = 0;
let failed = false;
async function inspect(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (['.git', '.codex', '.agents', 'node_modules', 'runtime', 'data'].includes(entry.name)) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (/\.(?:mjs|cjs|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true });
      checked++;
      if (result.status !== 0) {
        failed = true;
        console.error(result.stderr || 'Falha ao verificar um arquivo JavaScript.');
      }
    }
  }
}
await inspect(root);
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.devDependencies || {}).length) {
  failed = true;
  console.error('Ha dependencias externas; a entrega local deve funcionar apenas com Node.js.');
}
console.log(`${checked} arquivos JavaScript verificados. Sem dependencias npm externas.`);
process.exitCode = failed ? 1 : 0;

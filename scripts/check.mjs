import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const directory of ['src','server','scripts']) {
  for (const file of await readdir(directory)) if (/\.(?:mjs|js)$/.test(file)) execFileSync(process.execPath,['--check',`${directory}/${file}`],{stdio:'inherit'});
}
console.log('Syntax checks passed');

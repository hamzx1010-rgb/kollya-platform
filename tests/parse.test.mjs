// node --check misses module-scope duplicate declarations. This does not.
import { readFileSync, readdirSync } from 'fs';
import vm from 'vm';
const files = [];
for (const dir of ['core','features']) {
  for (const f of readdirSync(`/home/user/koliya/public/js/${dir}`)) files.push(`public/js/${dir}/${f}`);
}
files.push('public/js/app_sm.js');
let bad = 0;
for (const rel of files) {
  const src = readFileSync('/home/user/koliya/' + rel, 'utf8');
  try { new vm.SourceTextModule(src, { identifier: rel }); }
  catch (e) { bad++; console.log(`  FAIL ${rel}\n       ${e.message}`); }
}
console.log(bad ? `\n  ${bad} module(s) broken` : `  all ${files.length} modules parse as ES modules`);
// report in the runner's format
console.log(`${files.length - bad}/${files.length} passed`);

// Lightweight lint: verifies every relative import resolves to a file, and
// flags named imports from local modules that the module does not export.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(jsx?|mjs)$/.test(name)) files.push(full);
  }
};
walk('src');

let problems = 0;
const exportsOf = (file) => {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(',').forEach((n) => names.add(n.trim().split(/\s+as\s+/).pop()));
  if (/export\s+default/.test(src)) names.add('default');
  return names;
};

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // Specifiers never contain quotes or semicolons, so a match cannot span statements.
  for (const m of src.matchAll(/import\s+([^'";]*?)\s+from\s+'(\.[^']+)'/g)) {
    const target = resolve(dirname(file), m[2]);
    if (!existsSync(target)) {
      console.error(`✗ ${file}: cannot resolve ${m[2]}`);
      problems++;
      continue;
    }
    if (!/\.(jsx?)$/.test(target)) continue;
    const named = m[1].match(/\{([^}]+)\}/);
    if (!named) continue;
    const available = exportsOf(target);
    for (const n of named[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!available.has(n)) {
        console.error(`✗ ${file}: "${n}" is not exported by ${m[2]}`);
        problems++;
      }
    }
  }
}
console.log(problems ? `${problems} problem(s) found` : `${files.length} files checked, no import problems`);
process.exit(problems ? 1 : 0);

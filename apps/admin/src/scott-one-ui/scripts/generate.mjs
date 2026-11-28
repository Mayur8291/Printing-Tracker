import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(fs.readFileSync(path.join(root, 'tokens.json'), 'utf8'));
const kebab = value => value.replace(/[A-Z]/g, x => `-${x.toLowerCase()}`);
function flatten(value, prefix = []) {
  return Object.entries(value).flatMap(([key, entry]) => typeof entry === 'object'
    ? flatten(entry, [...prefix, kebab(key)])
    : [`  --sc1-${[...prefix, kebab(key)].join('-')}: ${entry};`]);
}
const { meta, skins, ...scales } = tokens;
let css = '/* Generated from tokens.json. Run node scripts/generate.mjs; do not edit. */\n';
css += `.sc1 {\n${flatten(scales).join('\n')}\n${flatten(skins.commerce).join('\n')}\n}\n`;
for (const [name, values] of Object.entries(skins)) {
  css += `.sc1[data-sc1-skin="${name}"], .sc1 [data-sc1-skin="${name}"] {\n${flatten(values).join('\n')}\n}\n`;
}
for (const name of Object.keys(tokens.type)) {
  css += `.sc1 .sc1-type-${name} { font-size: var(--sc1-type-${name}-size); line-height: var(--sc1-type-${name}-leading); font-weight: var(--sc1-type-${name}-weight); letter-spacing: var(--sc1-type-${name}-tracking); }\n`;
}
const target = path.join(root, 'tokens.css');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== css) throw new Error('tokens.css is out of date; run generate.mjs');
  console.log('Token CSS matches the JSON source.');
} else {
  fs.writeFileSync(target, css);
  console.log('Generated scoped tokens.css');
}

#!/usr/bin/env node
// Keeps the HTML pages and Strings.json in step. No dependencies.
//
//   node tools/strings.cjs              write the text from Strings.json into the HTML pages
//   node tools/strings.cjs --check      exit 1 if any page differs from Strings.json (nothing is written)
//   node tools/strings.cjs --from-html  the other way: copy text edited in the HTML into Strings.json
//
// Every element with data-s="key" holds the HTML stored under <page>.<key>; every data-s-attr="attr:key;…" pair
// holds an attribute (alt, aria-label, data-words…). A key missing from Strings.json leaves the page as it is.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES = [{ file: 'index.html', page: 'tour' }];
const check = process.argv.includes('--check');
const fromHtml = process.argv.includes('--from-html');

const strings = JSON.parse(fs.readFileSync(path.join(ROOT, 'Strings.json'), 'utf8'));
const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const set = (obj, p, v) => { const ks = p.split('.'); let o = obj; ks.slice(0, -1).forEach((k) => { o = o[k] ??= {}; }); o[ks.at(-1)] = v; };
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescAttr = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const START = /<([a-zA-Z][\w-]*)\b([^>]*\bdata-s(?:-attr)?="[^"]*"[^>]*)>/g;
const attrRe = (attr) => new RegExp(`(\\s${attr.replace(/-/g, '\\-')}=")([^"]*)(")`);

/** The end tag that closes the element whose start tag ends at `from` (same tag name, nesting-aware). */
function closeOf(html, name, from) {
  const re = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    if (m[2].toLowerCase() !== name) continue;
    if (m[1]) { if (--depth === 0) return { start: m.index, end: re.lastIndex }; }
    else if (!m[3]) depth++;
  }
  return null;
}
const pairs = (attrs) => { const m = /\bdata-s-attr="([^"]+)"/.exec(attrs); return m ? m[1].split(';').map((p) => [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1)]) : []; };
const contentKey = (attrs) => /\bdata-s="([^"]+)"/.exec(attrs)?.[1];

// ---------- HTML -> Strings.json ----------
if (fromHtml) {
  let n = 0;
  for (const { file, page } of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const update = (key, value) => {
      const full = `${page}.${key}`;
      if (get(strings, full) === value) return;
      set(strings, full, value); n++; console.log(`from HTML: ${full}`);
    };
    const re = new RegExp(START.source, 'g');
    let m;
    while ((m = re.exec(html))) {
      const name = m[1].toLowerCase(), attrs = m[2];
      for (const [attr, key] of pairs(attrs)) { const v = attrRe(attr).exec(attrs); if (v) update(key, unescAttr(v[2])); }
      const key = contentKey(attrs);
      if (key) { const close = closeOf(html, name, re.lastIndex); if (close) update(key, html.slice(re.lastIndex, close.start).replace(/\s*\r?\n\s*/g, ' ').trim()); }
    }
  }
  if (n) fs.writeFileSync(path.join(ROOT, 'Strings.json'), JSON.stringify(strings, null, 2) + '\n');
  console.log(n ? `Strings.json updated (${n} value${n === 1 ? '' : 's'})` : 'Strings.json already matches the pages');
  process.exit(0);
}

// ---------- Strings.json -> HTML ----------
let changed = 0;
const missing = new Set();
for (const { file, page } of PAGES) {
  const full = path.join(ROOT, file);
  const before = fs.readFileSync(full, 'utf8');
  // Attributes first (they only touch start tags)…
  const html = before.replace(new RegExp(START.source, 'g'), (whole, name, attrs) => {
    let a = attrs;
    for (const [attr, key] of pairs(attrs)) {
      const val = get(strings, `${page}.${key}`);
      if (typeof val !== 'string') { missing.add(`${page}.${key}`); continue; }
      const re = attrRe(attr);
      a = re.test(a) ? a.replace(re, (_, p1, _old, p3) => `${p1}${escAttr(val)}${p3}`) : `${a} ${attr}="${escAttr(val)}"`;
    }
    return `<${name}${a}>`;
  });
  // …then element contents.
  const re = new RegExp(START.source, 'g');
  let m, out = '', last = 0;
  while ((m = re.exec(html))) {
    const key = contentKey(m[2]);
    if (!key) continue;
    const name = m[1].toLowerCase(), openEnd = re.lastIndex;
    const close = closeOf(html, name, openEnd);
    if (!close) throw new Error(`${file}: no closing </${name}> for data-s="${key}"`);
    const val = get(strings, `${page}.${key}`);
    out += html.slice(last, openEnd);
    if (typeof val === 'string') out += val; else { missing.add(`${page}.${key}`); out += html.slice(openEnd, close.start); }
    out += html.slice(close.start, close.end);
    last = re.lastIndex = close.end;
  }
  out += html.slice(last);
  if (out !== before) {
    changed++;
    if (!check) fs.writeFileSync(full, out);
    console.log(`${check ? 'differs' : 'updated'}: ${file}`);
  }
}
if (missing.size) console.log(`Not in Strings.json (page text kept): ${[...missing].join(', ')}`);
if (check && changed) process.exit(1);
if (!changed) console.log('Pages already match Strings.json');

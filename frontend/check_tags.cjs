const fs = require('fs');
const { parse } = require('@vue/compiler-dom');
let s = fs.readFileSync('src/views/ParentDashboardView.vue', 'utf8');
const scriptIdx = s.indexOf('<script');
const lastClose = s.lastIndexOf('</template>', scriptIdx);
const startIdx = s.indexOf('<template>');
let tpl = s.slice(startIdx + '<template>'.length, lastClose);
tpl = tpl.replace(/\{\{[\s\S]*?\}\}/g, '');
const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
let m;
const stack = [];
const voids = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
const lineOf = (i) => tpl.slice(0, i).split('\n').length;
while ((m = tagRe.exec(tpl))) {
  const closing = m[1] === '/';
  const name = m[2];
  const self = m[4] === '/' || voids.has(name);
  if (closing) {
    if (stack.length && stack[stack.length - 1].name === name) {
      stack.pop();
    } else {
      console.log('MISMATCH </' + name + '> at L' + lineOf(m.index) + '; open stack: ' + stack.map((x) => x.name + '@L' + x.line).join(' > '));
      process.exit(0);
    }
  } else {
    if (!self) stack.push({ name, line: lineOf(m.index) });
  }
}
if (stack.length) console.log('UNCLOSED: ' + stack.map((x) => x.name + '@L' + x.line).join(' > '));
else console.log('BALANCED');

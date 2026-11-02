// Builds Scrapline from src/ into one page.
//   public/index.html   the whole game as a standalone web page (what Vercel serves)
//   dist/scrapline.html the same page without its outer <html>/<head> wrapper (for the Claude artifact)
import fs from 'fs';
const order = ['core', 'solar', 'world', 'globe', 'terrain', 'parts', 'designs', 'physics', 'weapons', 'sites', 'towns', 'flora', 'controls', 'sound', 'builder', 'game'];
const js = order.map(f => `/* ---- ${f}.js ---- */\n` + fs.readFileSync(`src/${f}.js`, 'utf8').replace(/^'use strict';\n/, '')).join('\n');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/all.js', "'use strict';\n" + js);
const head = fs.readFileSync('src/head.html', 'utf8');
const body = head + `\n<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n<script>\n'use strict';\n${js}\n</script>\n`;
fs.writeFileSync('dist/scrapline.html', body);
const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0a1117"/><rect x="10" y="22" width="44" height="16" rx="3" fill="#f0a32b"/><circle cx="20" cy="44" r="8" fill="#e7edef"/><circle cx="44" cy="44" r="8" fill="#e7edef"/><circle cx="20" cy="44" r="3" fill="#0a1117"/><circle cx="44" cy="44" r="3" fill="#0a1117"/></svg>');
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a1117">
<meta name="description" content="Scrapline: build vehicles from blocks and drive, fly and sail them around a whole planet.">
<link rel="icon" href="${icon}">
</head>
<body>
${body}</body>
</html>
`;
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/index.html', page);
console.log('bytes', body.length, '| public/index.html', page.length);

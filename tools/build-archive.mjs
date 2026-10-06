// Usage: node tools/build-archive.mjs StockTool2025.xlsx [another.xlsx ...]
// Writes public/data/archive.json: silo estimate history and refill log from older stock tools.
// The site shows these alongside the current ST26 (the current ST26 wins wherever both have the same day).
import XLSX from 'xlsx';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseArchive } = require('../public/js/st26-parser.js');

const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node tools/build-archive.mjs StockTool2025.xlsx [more.xlsx]'); process.exit(1); }
const archives = files.map(f => parseArchive(XLSX.readFile(f, { sheets: ['Bulk Demand'], cellFormula: false }), f.split(/[\\/]/).pop()));
fs.mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../public/data/archive.json', import.meta.url), JSON.stringify({ archives }));
archives.forEach(a => console.log(a.source + ':', a.history.length, 'estimate sets,', a.deliveryLog.length, 'deliveries,', a.history[0].date, 'to', a.history.at(-1).date));

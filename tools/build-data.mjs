// Usage: node tools/build-data.mjs path/to/ST_26.xlsx
// Writes public/data/st26.json (only the schedule, silo estimates, deliveries and silo recipe weights).
import XLSX from 'xlsx';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseWorkbook, SHEETS } = require('../public/js/st26-parser.js');

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/build-data.mjs ST_26.xlsx'); process.exit(1); }
const wb = XLSX.readFile(file, { sheets: SHEETS, cellFormula: false });
const data = parseWorkbook(wb, file.split(/[\\/]/).pop());
fs.mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../public/data/st26.json', import.meta.url), JSON.stringify(data, null, 1));
console.log('Schedule days:', data.schedule.dates.length, '| brews:', data.schedule.brews.length, '| to', data.schedule.lastBrew, '| deliveries:', data.deliveries.length);
if (Object.keys(data.unmapped).length) console.log('No silo recipe for:', data.unmapped);
if (data.schedule.skipped.length) console.log('Skipped schedule text:', data.schedule.skipped);

import fs from 'node:fs';
const p=fs.readdirSync('data/runs').at(-1);
const r=JSON.parse(fs.readFileSync(`data/runs/${p}/raw-results.json`));
console.log(Object.keys(r));console.log(r.results.length);console.log(JSON.stringify(r.results[0],null,2).slice(0,9000));
console.log(r.table?.head?.prompts?.map(p=>p.label));

import { launch, detail } from '../src/runner.js';
import fs from 'node:fs';
import path from 'node:path';
const id=process.argv[2];
if(!id){console.error('用法：npm run replay -- run-...');process.exit(1);}
const old=fs.existsSync(id)?{snapshot:JSON.parse(fs.readFileSync(fs.statSync(id).isDirectory()?path.join(id,'snapshot.json'):id,'utf8'))}:detail(id);
const state=launch({confirm_live:process.argv.includes('--confirm-live')},old.snapshot);
console.log(`复跑 ${id} → ${state.id}，原实验保持不变。`);

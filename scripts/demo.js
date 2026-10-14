import { seed } from '../src/seeds.js';
import { launch } from '../src/runner.js';
seed();
console.log(launch({name:'Mock 流水线验收 · 2模型×3策略×12题×2次',model_ids:['mock-kimi','mock-qwen'],prompt_ids:['direct','structured','verify'],dataset_id:'research-12',repeats:2}));

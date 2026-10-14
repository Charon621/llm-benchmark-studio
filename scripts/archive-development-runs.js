// 仅标记本轮开发已知误配记录；不删除文件或改变其他实验。
import path from 'node:path';
import { runDir,read,atomic } from '../src/storage.js';
for(const id of ['run-1791939121432-76789c','run-1791939163898-52bb0b']){
  const file=path.join(runDir(id),'state.json'),state=read(file);
  if(state) atomic(file,{...state,status:'invalid',error:'开发阶段 Promptfoo 配置适配失败（数组变量扩矩阵 / Windows文件路径冒号解析）；记录仅供审计，不用于实验结论。'});
}

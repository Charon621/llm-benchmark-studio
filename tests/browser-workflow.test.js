import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {chromium} from 'playwright';
import {createApp} from '../src/server.js';
import {inspectZip} from '../src/bundles.js';
const outputDir=process.env.STUDIO_QA_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'studio-ui-evidence-'));
fs.mkdirSync(outputDir,{recursive:true});
let server,browser,context,page,base,visionDatasetId,originalRunId;const errors=[];
before(async()=>{server=await new Promise(r=>{const s=createApp().listen(0,'127.0.0.1',()=>r(s))});base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto(base);await page.locator('#vision-builder').waitFor({state:'attached'});});
after(async()=>{fs.writeFileSync(path.join(outputDir,'uncaught-errors.json'),JSON.stringify(errors));await browser?.close();if(server)await new Promise(r=>server.close(r));});
let evidenceIndex=0;
afterEach(async()=>{if(page){evidenceIndex++;await page.screenshot({path:path.join(outputDir,'step-'+evidenceIndex+'.png'),fullPage:true});fs.writeFileSync(path.join(outputDir,'step-'+evidenceIndex+'.txt'),await page.locator('body').innerText());}});
async function nav(view){if(await page.locator('#nav-toggle').isVisible())await page.locator('#nav-toggle').click();await page.locator(`.nav-item[data-view="${view}"]`).click();}
async function next(){await page.locator('#wiz-next').click();}
async function completed(){await page.waitForFunction(()=>document.querySelector('#run-state').textContent.includes('已完成'),{},{timeout:45000});assert.equal(await page.locator('#empty-results').isVisible(),false);}
async function startAndWait(selector){const waiting=page.waitForResponse(r=>r.request().method()==='POST'&&(r.url().endsWith('/api/runs')||r.url().endsWith('/replay')));await page.locator(selector).click();const response=await waiting;assert.equal(response.status(),202);const state=await response.json();await page.waitForFunction(id=>document.querySelector('#experiment-subtitle').textContent.startsWith(id),state.id);await completed();return state.id;}
test('UI initial hidden state and text-only model defaults are correct',async()=>{
 assert.equal(await page.locator('#config-panel').isVisible(),false);await page.locator('#cta-new-run').click();
 assert.equal(await page.locator('#model-choices input:checked').count(),2);assert.equal(await page.locator('#model-choices input[value^="mock-vision-"]:checked').count(),0);
 await next();await next();await next();await page.locator('#run-form [name="repeats"]').fill('1');await next();await startAndWait('#run-submit');assert.match(await page.locator('#ranking-body').innerText(),/mock-kimi/);
});
test('actual file chooser and upload button decode PNG, JPEG, WebP and support retry after corrupt image',async()=>{
 await nav('datasets');const bad={name:'broken.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])};await page.locator('#asset-files').setInputFiles(bad);await page.locator('#upload-assets-btn').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('解码'));
 const inputs=[];for(const format of ['png','jpeg','webp'])inputs.push({name:'synthetic.'+format,mimeType:'image/'+format,buffer:await sharp({create:{width:80,height:60,channels:3,background:'#ce978a'}}).toFormat(format).toBuffer()});
 await page.locator('#asset-files').setInputFiles(inputs);await page.locator('#upload-assets-btn').click();await page.locator('#asset-list img').nth(2).waitFor();await page.locator('#vision-refresh-images').click();await page.locator('#vision-image-picker input').nth(2).waitFor();
 assert.equal(await page.locator('#asset-list img').count(),3);
});
test('visual dataset builder saves ordered image roles and individual reviewed versus pending annotations',async()=>{
 await page.locator('#vision-image-picker input').nth(0).check();await page.locator('#vision-image-picker input').nth(1).check();await page.locator('#vision-add-case').click();
 const f=page.locator('#vision-annotation-form');await f.locator('[name="question"]').fill('描述合成皮损夹具，不作真实诊断');await f.locator('[name="labels"]').fill('脱毛、鳞屑');await f.locator('[name="completeness"]').selectOption('complete');await f.locator('[name="answerability"]').selectOption('answerable');await f.locator('[name="source"]').selectOption('human');await f.locator('[name="review_status"]').selectOption('reviewed');await page.locator('#vision-case-images select').nth(1).selectOption('closeup');await f.locator('[type="submit"]').click();
 await page.locator('#vision-add-case').click();assert.equal(await f.locator('[name="review_status"]').inputValue(),'pending');await page.locator('#vision-dataset-name').fill('浏览器合成视觉验收');await page.locator('#vision-save-dataset').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('可评分 1/2'));
 visionDatasetId=await page.locator('#vision-edit-dataset').inputValue();assert.ok(visionDatasetId);await page.getByRole('button',{name:'按当前模板新增视觉提示词'}).click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已新增视觉输出策略'));
 await page.locator(`[data-preview-dataset="${visionDatasetId}"]`).click();await page.locator('#case-dialog').waitFor({state:'visible'});await page.locator('#close-dialog').click();
});
test('vision wizard runs real Promptfoo workers then renders F1, coverage and case detail without text assumptions',async()=>{
 await page.locator('#cta-new-run').click();await page.locator('#run-task-type').selectOption('vision');await page.locator('#model-choices input[value="mock-vision-kimi"]').check();await page.locator('#model-choices input[value="mock-vision-qwen"]').check();await next();await page.locator(`#dataset-choices input[value="${visionDatasetId}"]`).check();await next();await next();await page.locator('#run-form [name="repeats"]').fill('2');await next();await startAndWait('#run-submit');
 assert.match(await page.locator('#ranking-body').locator('..').innerText(),/Micro F1/);assert.match(await page.locator('#metric-cards').innerText(),/8\/8/);assert.equal(await page.locator('#weights').isVisible(),false);
 originalRunId=(await page.locator('#experiment-subtitle').innerText()).split(' · ')[0];assert.ok(originalRunId.startsWith('run-'));
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#toast')).display==='none');
 await page.screenshot({path:path.join(outputDir,'vision-results-1440.png'),fullPage:true});
});
test('case filters, image enlargement and manual review use actual dialog controls and persist after reload',async()=>{
 await page.locator('#case-model').selectOption('mock-vision-kimi');await page.locator('[data-case]').first().click();await page.locator('#case-detail img').first().click();await page.locator('.image-viewer').waitFor({state:'visible'});await page.getByRole('button',{name:'关闭大图'}).click();
 await page.locator('#review-form [name="category"]').selectOption('其他');await page.locator('#review-form [name="note"]').fill('仅合成数据的人工作业验收记录');await page.locator('#review-form [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已保存人工分类'));
 await page.reload();await page.locator('#vision-builder').waitFor({state:'attached'});await nav('analysis');await page.locator('[data-case]').first().waitFor();assert.match(await page.locator('#cases-body').innerText(),/人工已复核/);
});
test('download buttons deliver matching visual CSV, JSON and Markdown with latest human annotation and no embedded images',async()=>{
 for(const [format,match] of [['csv',/vision_f1/],['markdown',/Micro F1/],['json',/micro_f1/],['config',/图片仅通过显式图片包导出/]]){
   const download=page.waitForEvent('download');await page.locator('#export-'+format).click();const d=await download;const dest=path.join(outputDir,'visual-export.'+format);await d.saveAs(dest);const text=fs.readFileSync(dest,'utf8');assert.match(text,match);assert.ok(!text.includes('data:image/'));if(['csv','markdown','json'].includes(format))assert.match(text,/仅合成数据的人工作业验收记录/);
 }
});
test('replay creates a new run, preserves the original and can be cancelled with partial progress',async()=>{
 await startAndWait('#replay-run');assert.ok(!(await page.locator('#experiment-subtitle').innerText()).startsWith(originalRunId));
 await page.locator('#replay-run').click();await page.locator('#cancel-run').waitFor({state:'visible'});await page.locator('#cancel-run').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent.includes('已取消'));assert.ok(await page.locator('#ranking-body').innerText());
});
test('ZIP selection, explicit image inclusion, preview and import create new resources using actual buttons',async()=>{
 await nav('datasets');await page.locator(`#bundle-resources input[value="${visionDatasetId}"]`).check();await page.locator('#bundle-images').check();const waiting=page.waitForEvent('download');await page.locator('#bundle-export').click();const download=await waiting,file=path.join(outputDir,'selected-visual-bundle.zip');await download.saveAs(file);const files=inspectZip(fs.readFileSync(file));assert.ok(Object.keys(files).length>=3);
 await page.locator('#bundle-file').setInputFiles(file);await page.locator('#bundle-preview').click();await page.waitForFunction(()=>document.querySelector('#bundle-import-preview').textContent.includes('"dry_run": true'));await page.locator('#bundle-import').click();await page.waitForFunction(()=>document.querySelector('#bundle-import-preview').textContent.includes('"dry_run": false'));assert.equal(await page.locator('#dataset-list article').filter({hasText:'浏览器合成视觉验收'}).count(),2);
});
test('mobile/tablet/desktop result layouts and image dialogs have no horizontal document overflow or uncaught errors',async()=>{
 await nav('analysis');
 for(const width of [390,1024,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+5),false,`overflow at ${width}`);await page.screenshot({path:path.join(outputDir,'visual-layout-'+width+'.png'),fullPage:true});}
 assert.deepEqual(errors,[]);
});

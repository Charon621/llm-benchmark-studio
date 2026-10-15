# LLM Benchmark Studio

> 2026-10-15 修复说明与当前本机验收：[使用、恢复和验收记录](docs/视觉工作流与验收_2026-10-15.md)。历史章节中的测试数字保留为当时快照；真实云端模型验证仍待具体授权。

一个基于 **Promptfoo 0.124.1** 的本地中文评测工作台。它调用 Promptfoo 的原生 `evaluate()`、`is-json`、`contains`、`javascript` 和可选 `llm-rubric`，围绕原生引擎提供提示词版本、数据导入、冻结配置、稳定性、失败案例和实验审计。

**已验证 Mock 流水线、原生 Promptfoo 多选矩阵和 OpenAI/Anthropic 本地协议夹具；没有发起真实云端模型付费调用。** Mock 模型直接读取人工参考答案，含预置错误；这些分数不能证明模型能力或 Agent 架构优劣。可在网页「模型管理」填写自己的账号模型与密钥，再明确授权连接测试或实验。

## 5 分钟运行

需要 Node.js **22.22.0+**，推荐 Node.js 24 LTS。当前开发验证为 Windows / Node 24.16.0。安装依赖会访问 npm。

```bash
npm ci
npm start
```

浏览器打开 <http://127.0.0.1:8812>。Windows 也可双击 `启动.cmd`，Git Bash / macOS / Linux 可执行 `bash start.sh`。默认仅监听本机，不需要 API Key。页面选择默认两个 Mock provider、三种提示词、12 道研究题、重复两次，点击「开始评测」得到 **144 个实际执行的 Promptfoo 单元**。

```bash
npm test              # 核心、原生 Promptfoo、HTTP 夹具、API 完整流程
npm run demo          # 命令行运行 144 单元 Mock 演示
npm run replay -- <实验ID>
npm run replay -- reports/mock-2026-10-14/snapshot.json
```

`npm start` 直接读取进程环境；如果使用 `.env` 文件，运行 `bash start.sh` / `启动.cmd`，或者：

```bash
node --env-file-if-exists=.env src/server.js
```

首次依赖安装在本机约 3 分钟，Promptfoo 为完整依赖，磁盘体积明显大于本项目源码。启动不需要编译前端，也不使用外部字体或 CDN。

## 已实现功能

| 功能 | 行为 |
|---|---|
| 多模型 | 独立网页配置 Kimi、Qwen、DeepSeek、GLM、OpenAI、Anthropic、自定义 API；OpenAI Chat 与 Anthropic Messages 原生协议；保留 Mock、环境变量与 AgentLab single / multi |
| 配置管理 | 创建/编辑/删除/默认模型；密码显示开关；只删除凭证；明确授权的最小连接测试；401/403、404、429、超时、网络与协议错误分别显示 |
| 凭证与会话 | 随机 HttpOnly、SameSite=Strict cookie；配置与实验按会话隔离；模型定义持久化、API Key/联动Token只在后端内存；worker仅通过IPC取得所选凭证 |
| 提示词 | 默认直接回答、结构化证据、交叉核查三策略；创建、编辑生成版本、历史、删除；旧实验保留原文 |
| 数据集 | CSV / JSON 导入、必填校验、重复ID校验、JSON参考结构校验、安全断言白名单；1–200题 |
| 批量实验 | 模型 × 提示词 × 题目 × 重复次数；最大1500单元；缓存关闭；有限并发 |
| 规则评价 | Promptfoo 原生断言；JSON任务要求字段、字段类型、不允许额外字段 |
| 参考评价 | 人工参考事实词覆盖，逐项命中依据可查看；不把覆盖率称为语义准确率 |
| 可选语义评审 | 原生 `llm-rubric`，固定Qwen judge、rubric、温度0；独立分数与原始理由；调用计入共享预算 |
| 指标 | 任务通过率、JSON合规、事实词覆盖、可选Judge分、延迟、服务端usage Token、已配置价格成本、重复输出稳定性 |
| 分析 | 模型图表、提示词敏感性、难度分层、可调权重排行榜、评分覆盖率 |
| 失败案例 | 原始输出、完整断言理由、错误与来源、人工改分类和复核说明；保留自动评分 |
| 可复现 | 冻结模型/端点/参数/价格、提示词版本、数据与hash、断言、源码hash、时间、原始SDK结果与ledger |
| 导出 | JSON、CSV、Markdown、原生Promptfoo配置与原始结果；CSV防公式注入 |
| 恢复 | 每单元落盘、取消保留已完成结果、服务重启标记interrupted、复跑新建实验、不覆盖原记录 |

## 架构与数据流

```mermaid
flowchart TD
  UI[中文 Web 工作台] --> API[Express 本机 API :8812]
  API --> LIB[提示词与数据集 JSON 注册表]
  API --> SNAP[冻结配置与 SHA256]
  SNAP --> WORKER[可取消子进程]
  WORKER --> PF[Promptfoo evaluate 原生引擎]
  PF --> PROVIDER[自定义 provider 适配层]
  PROVIDER --> MOCK[Mock 参考答案夹具]
  PROVIDER --> CHAT[Kimi / Qwen Chat Completions]
  PROVIDER --> AGENT[AgentLab :8811 single / multi]
  PF --> RULE[原生断言与 JSON schema]
  PF --> REF[人工事实词 reference assertion]
  PF --> JUDGE[可选原生 llm-rubric]
  JUDGE --> PROVIDER
  PROVIDER --> LEDGER[共享预算 / 超时 / 重试 / 成本预留]
  PF --> RAW[原始 Promptfoo 结果]
  RAW --> ANALYSIS[模型汇总 / 稳定性 / 排名 / 失败分类]
  ANALYSIS --> STORE[每单元原子落盘]
  STORE --> UI
  STORE --> EXPORT[JSON / CSV / Markdown / 复跑]
```

```text
src/
  server.js              HTTP API、本机访问防护、导出
  storage.js             原子JSON持久化、ID、hash
  seeds.js / datasets.js 默认资料、导入与校验
  models.js / config.js  模型注册、配置冻结、原生Promptfoo套件生成
  runner.js / worker.js  子进程调度、取消、恢复、原生引擎执行
  provider.js            Mock/实时HTTP/AgentLab适配、重试与共享预算
  reference-assertion.js Promptfoo执行的人工事实词断言
  analysis.js            缺失值、稳定性、排名、报告
public/                   无构建步骤的中文界面
examples/                 12道研究探针、CSV模板、原生Judge参考片段
tests/                    核心、原生引擎、HTTP传输、API流程
reports/                  已实际运行的Mock报告与复现快照
data/                     本机运行时数据；Git忽略
```

## 网页模型配置（推荐）

打开左侧「模型管理」，选择供应商和协议，填写账号实际可用的模型 ID、HTTPS Base URL、API Key、温度与输出 Token 上限。供应商预设只提供端点，模型名称由你填写。保存后可设默认、编辑、删除配置或仅删除凭证；API Key 保存后清空输入框，不通过查询接口返回，也不存浏览器 localStorage。

能力由配置显式声明：可以关闭 temperature（部分推理模型不支持），选择 `max_tokens` / `max_completion_tokens`，并标记是否支持原生工具调用。`auto` 对 OpenAI 选 `max_completion_tokens`，其余选 `max_tokens`；Anthropic 固定原生 `max_tokens`。不要仅凭供应商名称推定某个型号支持 temperature 或工具。

点击「测试连接 · 真实 API」发送最多16输出Token的最小请求，因此也可能产生费用。实验仍须单独勾选本次实时授权。网页模型无需再设置 `STUDIO_ENABLE_LIVE`，旧环境变量模型继续受该开关控制。测试结果仅说明端点、凭证与协议可用，不是模型质量评价。

同一网页模型可与多个其他模型一起参与原生 Promptfoo 的模型 × 提示词 × 题目 × 重复矩阵。每个模型的配置版本、credential ID、能力与实际参数冻结；`settings.effective_model_parameters`明确记录逐模型实际温度/Token上限。网页模型使用自己的保存参数，环境变量模型使用实验表单参数。

模型定义保存在 `data/model-definitions.json`，不含 API Key。重启后同一浏览器仍可查看定义，凭证显示未配置，需重新填 Key。修改已存在的 Key 创建新凭证版本，旧冻结实验继续使用旧版本；明确删除凭证会删除此模型的全部内存版本并取消相关运行，旧快照随后不能调用或复跑。补充当前缺失 Key 保留其 credential ID；历史版本可在网页恢复选择中显式补充。已存在的历史版本不能被覆盖。

会话 cookie 是本地工作区访问凭证。不同浏览器/无痕会话看不到对方模型、实验或导出，也不能操作对方实验；这是本地会话隔离，不是账号登录。首次建立的本机会话拥有旧单用户资料和 `.env` 使用权。升级前无 owner 的旧实验保留原文件，只有该会话可以明确执行「认领本机旧实验」，迁移后实验读写与导出同样受会话保护。请保留原浏览器的 cookie。

## 环境变量配置（兼容旧版）

复制 `.env.example` 为 `.env`，只在本机填写，不提交密钥：

```dotenv
KIMI_API_KEY=你的密钥
KIMI_BASE_URL=https://api.moonshot.cn/v1
KIMI_MODEL=你账户可用的模型或固定版本
QWEN_API_KEY=你的密钥
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=你账户可用的模型或固定版本
STUDIO_ENABLE_LIVE=1
```

不同账号、区域和时间可用的模型与端点可能不同，请按供应商账号文档核对；仓库默认模型名称只是可修改的配置。`.env.example`也列出 DeepSeek、GLM、OpenAI、Anthropic 和自定义配置。界面高级设置保留旧环境变量模型的版本、端点、价格覆盖。环境变量 Key 不返回前端、不写快照；仅首次本机会话或命令行可使用。

实时调用需要同时满足：服务环境 `STUDIO_ENABLE_LIVE=1`、相应Key已配置、选择实时provider、勾选当次费用授权。默认不会偷偷调用云端服务。所有保存的报告都明确标注执行模式。

外部 API 必须 HTTPS，拒绝 URL 内嵌凭据、私网/loopback/link-local/保留地址与重定向；DNS 检查全部 A/AAAA，并固定校验后的 IP 连接，同时保留原 Host/SNI 与 TLS 证书验证。为避免 DNS 重绑定和代理绕过，模型传输不读取系统代理。测试中的 HTTP loopback 只通过显式依赖注入，不是生产配置豁免。

worker 环境剔除 Key/Token/Secret/Password 和代理变量，仅通过 IPC 获取本场选中的凭证；snapshot、Promptfoo 配置、原始结果、引擎日志和导出不携带密钥。HTTP 错误正文不保存，成功响应意外回显当前凭证也会清洗。无服务端 usage 或价格时指标保持未知；Anthropic缓存输入计入总Token，缓存计费缺少专用单价时费用保持未知。

### 超时、重试与成本

- 平台请求上限 `max_calls` 包括生成、重试和Judge；最大重试2次，429/5xx/网络超时有限退避，400等请求错误不盲目重试。
- 每次请求受单次超时和实验剩余时间限制；实验另有总超时。取消终止子进程，父服务断开也停止worker。
- 已知价格时并发调用先预留保守成本，再发送请求。美元预算要求所有启用的实时provider（包括Judge）都配置价格；价格未知时用调用预算。
- API失败可能已经计费，因此失败尝试保留保守预算承诺。重试后成功单元的**整体Token与成本仍记未知**，`successful_attempt_*`保留成功那次已知usage，不把它冒称整个单元的总费用。
- 每模型表格只统计生成Token/费用，**不含Judge**。`cost_audit`单列Judge请求/费用、实验总费用和已知覆盖率；只要任一尝试费用未知，完整总费用是null。`known_cost_subtotal_usd`仅是已知小计。
- AgentLab每题内部模型调用由其 `agent_max_calls`约束；平台上限是外层HTTP请求数。内部调用数量另记 `agent_internal_model_calls`，不能混加或声称为同一种预算。

## 如何解释评分

**规则**检查预定义要求；**参考事实词**只是人工事实清单的覆盖探针。它可能漏掉同义表达，也可能把包含关键词但上下文错误的答案判通过。任何事实结论都应人工阅读原始输出并核验来源。

要进行语义评审，可在实时实验中启用固定Qwen Judge，工作台通过Promptfoo原生 `llm-rubric`调用同一预算适配层。Judge模型、端点、rubric、温度和价格都冻结。评分与理由保存在 `grading.componentResults`，`judge_score`单独记录。Judge故障标记「评估失败」、Judge分为null、从质量分母剔除并显示覆盖率；不会把预算耗尽包装成模型回答错误。

Judge可能存在位置、风格、同源和幻觉偏差。建议随机抽样人工复核，尤其检查事实与引用。一次“审查通过”或Judge高分不能代替外部事实核验。

稳定性定义为每个同模型/同题/同提示词重复组中**完全相同原始输出的众数比例**，再汇总。组数未完成、未达到预设重复次数或没有可用输出时不作完整稳定性结论。它对无关标点变化也敏感；稳定地重复错误仍会很稳定，不能叫准确率。

加权排行榜的质量、速度、成本、稳定性权重由用户选择。任何启用维度缺失，该模型不参与完整综合排名；默认Mock成本未知，所以默认成本权重为0。排名是该样本与主观偏好下的计算，不是客观模型实力榜。

## 数据导入与人工复核

CSV模板见 `examples/import-example.csv`，JSON示例见 `examples/research-cases.json`。文本样本必须有 `question`、人工`reference`和`facts`；`facts`在CSV用`|`分隔，JSON用字符串数组。可选 `difficulty`、`expect_json`、`assertions`、`source_urls`。视觉样本使用 images、ground_truth 和 annotation 独立结构。

仅接受 `contains`、`icontains`、`not-contains`、`equals`、`is-json`断言，导入不会执行任意JavaScript。JSON任务的参考答案须是字符串字段对象，原生schema据此约束同名必需字段和类型。

示例12题是3道简单、5道中等、4道困难的**小型工程/方法学探针**，不代表所有深度研究任务。R05/R09/R11包含作者预设方法清单，官方文档链接只是配置或概念背景；不能把它当逐句权威证明。来源链接是人工复核入口，未自动证明URL持续可访问或支持模型的每个论断。

在输出明细点击「查看 / 复核」，核对原始输出、原生断言、参考答案、来源和trace；完成或取消实验后可保存人工分类与说明。自动评分保持原样。CSV导出会对可能被Excel当公式的字符串加单引号，JSON保留原始文本。

## AgentLab 联动

实时联动先在 AgentLab 的「模型配置」为指定模型生成限时授权，在 Studio「模型管理」的联动区填写 `http://127.0.0.1:8811`、模型配置 ID 与授权 Token。Studio 后端通过 Bearer token 获取该指定模型的非秘密元信息，验证后添加相同模型的 single/multi 选项。Token仅在内存，不回读、不持久化；远端授权到期/撤销后调用拒绝，Studio断开连接也会删除本地Token并取消相关运行。

桥接只接受显式 loopback IP 的 HTTP 本地服务。每次 benchmark 请求带 `model_config_id`、`expected_config_version` 和 Bearer grant；远端版本改变返回409，避免单/多架构运行期间换模型。两架构采用同一模型配置、研究提示词、数据、温度/Token上限、每题内部调用预算与超时，结果保存 AgentLab 实际冻结 `model_config` 供核对。API Key 本身不会跨项目共享。旧的无Key Mock联动仍可直接运行。

先独立启动AgentLab（<http://127.0.0.1:8811>），点击「AgentLab 单 / 多对照」。两架构接受相同题目、模型provider、temperature、研究策略、每题内部调用预算和超时。调用契约：

```json
{
  "task_id":"实验-题目-重复-单元hash",
  "question":"原始问题（检索用）",
  "research_instructions":"已渲染提示词（模型用）",
  "mode":"single",
  "execution_mode":"mock",
  "provider":"qwen",
  "temperature":0,
  "max_calls":8,
  "timeout_seconds":30
}
```

响应要求 `schema_version:"1.0"`，包含`output`、`sources`、`metrics`与`trace`；`success:false`会保存为失败。模型、模式、提示词、重复次生成独立task_id，同一单元重试保持task_id与任务配置一致。AgentLab返回研究策略hash和provider冻结信息用于核对。

真实公平比较还要控制搜索工具与来源快照，按难度分层、人工核验事实与引用，记录外部网页变化。集成接口和Mock结果只能证明工程闭环；本轮没有真实云端单/多Agent质量比较，也没有预注册推断检验，不宣称普遍优越或统计显著。

## 持久化、恢复与复现文件

`data/library.json`保留当前注册表。每个`data/runs/<实验ID>/`包含：

| 文件 | 内容 |
|---|---|
| `snapshot.json` | 完整冻结模型、提示词、数据、参数、评估标准、hash和时间 |
| `promptfooconfig.json` | 实际交给Promptfoo的配置；cache:false |
| `state.json` | 运行状态、已完成数、错误与结束时间 |
| `rows.json` | 已完成单元、原始输出、断言、人工标注 |
| `raw-results.json` | 最终Promptfoo `toEvaluateSummary()`原始结果 |
| `ledger.json` | 各次平台请求、重试、usage、Judge与预算承诺 |
| `report.json` / `report.md` / `results.csv` | 完成时生成的报告；API导出实时采用最新人工标注 |
| `engine.log` | 引擎错误与执行信息，不保存HTTP错误正文 |

关键文件原子替换，辅助ledger损坏不会阻止读取/导出已完成rows。服务重启把遗留running/queued标为interrupted，保留内容；点击复跑使用冻结样本、提示词、模型和参数生成新ID，调用会重新执行，旧记录不覆盖。**这是安全重跑，不是自动续接半次模型调用。** 实时重跑仍须授权。源文件hash便于审计；如果源码或供应商后端版本变化，结果仍可能变化。

## API 与测试

`GET /api/health`、`GET /api/library`；提示词`POST/DELETE /api/prompts`；数据集`POST/DELETE /api/datasets`；实验`POST/GET /api/runs`、`GET /api/runs/:id`、`POST .../cancel`、`POST .../replay`；复核`PATCH .../rows/:rowId`；导出`GET .../export/{json,csv,markdown,config,raw}`。

模型：`GET/POST /api/models`、`PATCH/DELETE /api/models/:id`、`POST /api/models/:id/default`、`POST .../test {confirm_live:true}`、`DELETE .../credential`、`POST .../credential {api_key,credential_id?}`。联动：`GET /api/integration`、`POST /api/integration/import {url,token,model_config_id}`、`DELETE /api/integration/:id`。旧记录：`GET /api/legacy`、`POST /api/legacy/import {confirm:true}`。所有请求应保存并发送自己的会话 cookie；Token导入与Key写入的响应都不回读秘密。

```json
POST /api/runs
{"name":"Mock比较","dataset_id":"research-12","model_ids":["mock-kimi","mock-qwen"],"prompt_ids":["direct","structured","verify"],"repeats":2}
```

本地自动化覆盖原有24单元 Mock 原生Promptfoo矩阵与新增16单元 OpenAI/Anthropic混合协议矩阵、模型CRUD/默认/凭证版本恢复、会话实验全部入口隔离、旧记录迁移与 `.env` 归属、JSON错误不反射密钥、SSRF/DNS固定/重定向拒绝、HTTP错误分类、重试与未知费用。测试HTTP服务是本机夹具，不使用云端模型Key。GitHub Actions定义了Windows/Ubuntu Node24检查；远端CI实际状态以仓库Actions为准。

## 界面设计

`public/` 为无构建步骤的中文工作台：白 / 浅灰底色配深蓝强调色，统一 SVG 描边图标，不使用外部字体或 CDN。顶部导航分为概览、实验、结果分析、数据集、提示词、模型管理与方法。概览页汇总实验统计、性能 / 延迟 / 成本图表（纯 SVG 绘制，只用真实实验数据，未知费用明确标未知）与最近实验；新建实验为五步向导（模型 → 数据集 → 提示词 → 参数 → 确认），启动前展示完整配置、预计执行单元数与实时费用授权；结果分析页提供进度与取消、模型对比、提示词敏感性、可调权重排行榜、失败案例筛选与人工复核弹窗。表格支持横向滚动与粘性表头，界面适配桌面、平板与手机宽度，支持键盘焦点与系统减少动态设置。

## 框架依据与范围

开发前核验npm registry稳定版`promptfoo@0.124.1`及Node要求；SDK的`evaluate()`返回Eval记录，再`await record.toEvaluateSummary()`。官方依据：[Node包](https://www.promptfoo.dev/docs/usage/node-package/)、[Node API](https://www.promptfoo.dev/docs/usage/node-api-reference/)、[配置](https://www.promptfoo.dev/docs/configuration/reference/)、[断言](https://www.promptfoo.dev/docs/configuration/expected-outputs/)、[Judge偏差](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/)。

没有账号登录或分布式调度；只用于本机实验，会话级模型/实验隔离已实现。默认关闭Promptfoo遥测、更新检查与共享；明确授权实时provider后会把所选问题/提示词发送给模型服务。源码MIT许可。

协议依据：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[Anthropic缓存usage](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)、[OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)。

## 2 分钟演示顺序

0:00–0:20：说明Mock标识与配置矩阵；0:20–0:45：运行并观察逐单元进度；0:45–1:10：比较通过率、稳定性与提示词；1:10–1:30：查看失败案例并保存人工复核；1:30–1:45：导出JSON/Markdown；1:45–2:00：展示提示词版本、CSV导入与AgentLab对照入口。展示的必须是实际界面操作；真实能力结论需要另行实调实验。

# 已运行的Mock流水线验收（非真实模型实验）

执行模式：**MOCK**；Promptfoo 0.124.1
时间：2026-10-14T01:07:44.420Z

**此处是实际运行的 Mock 流水线结果，使用参考答案夹具，不能作为真实模型能力或 Agent 架构优劣证据。**

数据 SHA256：56d4ff70a96670e7a27b80e4006b6bc746d9a32601808d9eca6e5306279ea3bd
提示词 SHA256：f4896bcaac8ef5126945a3e47d951a08ef4ba3522cbf9099e172c0b908945dea

| 模型 | 任务通过率 | 事实词覆盖 | JSON合规 | 延迟 ms | 生成Token | 生成费用USD（不含Judge） | 稳定性 |
|---|---:|---:|---:|---:|---:|---:|---:|
| mock-kimi | 100.0% | 100.0% | 100.0% | 22.9 | 未知 | 未知 | 100.0% |
| mock-qwen | 33.3% | 33.3% | 33.3% | 13.8 | 未知 | 未知 | 66.7% |

权重是主观配置。任一启用维度缺失则不参与综合排名；成本未知请将成本权重设为 0。稳定性为同题同提示词重复输出的众数占比，不代表准确率；未完成重复组不形成稳定性结论。

## 调用审计与评审开销

生成费用列不含 Judge。实验总费用必须同时纳入生成、重试与评审；未知费用不得记为零。
{
  "platform_requests": 0,
  "agent_internal_model_calls": 0,
  "known_cost_requests": 0,
  "total_cost_usd": null,
  "known_cost_subtotal_usd": null,
  "judge_requests": 0,
  "judge_cost_usd": null,
  "note": "已知费用小计不是完整总费用；未知项为null。平台请求与AgentLab内部模型调用分开计数。"
}

## 方法与限制

- 评测单元：models × prompts × cases × repeats；缓存关闭。
- 规则使用 Promptfoo 原生断言；参考答案使用明确人工事实词覆盖，保存逐项评分依据。
- 未提供价格或 usage 时记 null。LLM Judge 默认关闭；Judge 不是客观事实核验。评审基础设施失败单列，剔除质量分母并保留覆盖率。
- 失败案例分类支持人工修改。来源 URL 是人工参考入口，未自动证明网页始终可访问。
- 本实验未预注册抽样与推断检验，仅作描述性分析，不能据此宣称普遍性能优越。

## 失败案例

- R01 / mock-qwen / direct@v1 / repeat 1：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R01 / mock-qwen / direct@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R01 / mock-qwen / structured@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R01 / mock-qwen / verify@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R02 / mock-qwen / direct@v1 / repeat 1：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R02 / mock-qwen / direct@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R02 / mock-qwen / structured@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R02 / mock-qwen / verify@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R03 / mock-qwen / direct@v1 / repeat 1：格式错误；人工事实词覆盖 0/2；命中：无。需人工复核上下文与否定关系。
- R03 / mock-qwen / direct@v1 / repeat 2：格式错误；人工事实词覆盖 0/2；命中：无。需人工复核上下文与否定关系。
- R03 / mock-qwen / structured@v1 / repeat 2：格式错误；人工事实词覆盖 0/2；命中：无。需人工复核上下文与否定关系。
- R03 / mock-qwen / verify@v1 / repeat 2：格式错误；人工事实词覆盖 0/2；命中：无。需人工复核上下文与否定关系。
- R04 / mock-qwen / direct@v1 / repeat 1：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R04 / mock-qwen / direct@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R04 / mock-qwen / structured@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R04 / mock-qwen / verify@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R05 / mock-qwen / direct@v1 / repeat 1：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R05 / mock-qwen / direct@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R05 / mock-qwen / structured@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R05 / mock-qwen / verify@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R06 / mock-qwen / direct@v1 / repeat 1：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R06 / mock-qwen / direct@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R06 / mock-qwen / structured@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R06 / mock-qwen / verify@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R07 / mock-qwen / direct@v1 / repeat 1：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R07 / mock-qwen / direct@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R07 / mock-qwen / structured@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R07 / mock-qwen / verify@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R08 / mock-qwen / direct@v1 / repeat 1：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R08 / mock-qwen / direct@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R08 / mock-qwen / structured@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R08 / mock-qwen / verify@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R09 / mock-qwen / direct@v1 / repeat 1：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R09 / mock-qwen / direct@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R09 / mock-qwen / structured@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R09 / mock-qwen / verify@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R10 / mock-qwen / direct@v1 / repeat 1：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R10 / mock-qwen / direct@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R10 / mock-qwen / structured@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R10 / mock-qwen / verify@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R11 / mock-qwen / direct@v1 / repeat 1：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R11 / mock-qwen / direct@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R11 / mock-qwen / structured@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R11 / mock-qwen / verify@v1 / repeat 2：事实词缺失；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R12 / mock-qwen / direct@v1 / repeat 1：格式错误；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R12 / mock-qwen / direct@v1 / repeat 2：格式错误；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R12 / mock-qwen / structured@v1 / repeat 2：格式错误；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。
- R12 / mock-qwen / verify@v1 / repeat 2：格式错误；人工事实词覆盖 0/3；命中：无。需人工复核上下文与否定关系。

## 可复跑

冻结包包含 snapshot.json、promptfooconfig.json、raw-results.json、rows.json 与 ledger.json。运行 npm run replay -- <实验ID>；会保留原实验，创建新的实验ID。
完整明细在 results.csv / report.json。
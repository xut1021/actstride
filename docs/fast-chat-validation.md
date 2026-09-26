# 其他快速模型的桌面判断实测

日期：2026-09-27（Asia/Shanghai；原始时间戳采用 UTC）。[完整记录](fast-chat-validation.json)。

用 Gemini 3.5 Flash-Lite 和 GPT-4.1 Nano 各做 6 题、重复 2 轮，共 24 次真实模型请求和 Windows UIA 按钮操作。24 次均取得答案并完成验证，没有网络失败、跳过或模型转交；其中 15 次正确、9 次错误。

| 模型 | 正确率 | 全部任务中位秒数 | 正确任务中位秒数 | 确认 API 费用 |
|---|---:|---:|---:|---:|
| google/gemini-3.5-flash-lite | 9/12 | 1.35 | 1.35 | $0.0009510 |
| openai/gpt-4.1-nano | 6/12 | 1.25 | 1.31 | $0.0003174 |

速度快不等于操作可靠。Gemini 两次都在 judgment_4 选择了总价 30 美元的 A，正确答案为总价 27 美元的 C；另一次 judgment_3 错选人工审核，第二次答对。Nano 在两道工单分流题中都选择了人工审核，并且两次选错 judgment_4；其余三题两轮均正确。人工审核是题目里的业务按钮，选择它不等于控制器转交或自动免责。

## 与 Jev 的关系

此前 Jev 完成判断 8/9 正确，正确任务中位耗时 2.47 秒，另有一次网络失败，见[历史实验](windows-judgment-validation.md)。当前结果没有证明两个新模型能提高正确率。它们与 Jev 是不同时间、不同接口的运行，样本和重复次数也不完全一致，不能据此给模型做通用排名。没有同时重跑 Astra，也不将此次结果包装成新的 Astra 加速比。

测试继续使用相同的六道可见规则、证据和业务候选，以及未改动的独立答案验证器。各轮交替两个模型的顺序；正确答案只在 fixture 内，不发送给模型。只要求候选 ID，不要求解释，不针对错题修改提示。

## 接口与测量

新增实验入口：`node windows/chat-comparison.mjs`。使用 OpenRouter Chat Completions 的[结构化输出](https://openrouter.ai/docs/guides/features/structured-outputs)，将生成结果限制为当前候选或 escalate；宿主仍独立校验候选。不同于 Jev Decisions，这条路线不提供候选概率，程序不会把生成文本伪装成校准后的置信度。

这轮单独测快速模型，没有接 Astra 兜底；若返回 escalate 会记为 abstained、未完成。温度 0，最大输出 512 tokens，未显式设置 reasoning 参数，其他推理行为由提供方默认值决定。没有自动重试或提供方故障转移；模型返回标识和提供方、用量均保留。模型支持情况和价格在本次运行前通过实时目录校验，没有下载本地权重。

任务时间从首次观察结束到判断、再次观察、真实点击与独立回执验证结束；窗口启动和最终截图单列，不计入任务时间。这里只涉及合成 Windows Forms 单步判断，输入为 UIA 文本，不是纯视觉或第三方软件测试。重复题并非新的独立样本，成功率不能外推。

## 费用与验证

新增已确认模型请求费用 $0.0012684。此前未知请求根据提供方累计用量保守结算 $0.000199206：这是把所有未匹配用量归入预留，不是逐请求账单证明，历史失败仍保留。当前共享账本已确认 $0.041264747 / $20，未结算预留为 0。

新增适配器及已有计费/转交相关本地测试 14/14 通过，覆盖候选拒绝、无虚构概率、费用先结算再校验、未知费用阻断后续请求。真实运行 24 次另列，不把测试通过等同于模型答对。

## 全部运行

| 重复 | 题目 | 模型 | 选择 | 结果 | 任务秒数 |
|---|---|---|---|---|---:|
| 1 | judgment_1 | google/gemini-3.5-flash-lite | Hardware | passed | 1.67 |
| 1 | judgment_1 | openai/gpt-4.1-nano | Manual review | wrong | 1.70 |
| 1 | judgment_2 | openai/gpt-4.1-nano | Manual review | wrong | 1.75 |
| 1 | judgment_2 | google/gemini-3.5-flash-lite | Billing | passed | 1.26 |
| 1 | judgment_3 | google/gemini-3.5-flash-lite | Manual review | wrong | 2.14 |
| 1 | judgment_3 | openai/gpt-4.1-nano | Supplier B | passed | 1.76 |
| 1 | judgment_4 | openai/gpt-4.1-nano | Supplier A | wrong | 1.15 |
| 1 | judgment_4 | google/gemini-3.5-flash-lite | Supplier A | wrong | 1.79 |
| 1 | judgment_5 | google/gemini-3.5-flash-lite | Manual review | passed | 1.36 |
| 1 | judgment_5 | openai/gpt-4.1-nano | Manual review | passed | 1.34 |
| 1 | judgment_6 | openai/gpt-4.1-nano | Approve | passed | 1.24 |
| 1 | judgment_6 | google/gemini-3.5-flash-lite | Approve | passed | 1.84 |
| 2 | judgment_1 | openai/gpt-4.1-nano | Manual review | wrong | 1.11 |
| 2 | judgment_1 | google/gemini-3.5-flash-lite | Hardware | passed | 2.09 |
| 2 | judgment_2 | google/gemini-3.5-flash-lite | Billing | passed | 1.21 |
| 2 | judgment_2 | openai/gpt-4.1-nano | Manual review | wrong | 1.00 |
| 2 | judgment_3 | openai/gpt-4.1-nano | Supplier B | passed | 1.17 |
| 2 | judgment_3 | google/gemini-3.5-flash-lite | Supplier B | passed | 1.35 |
| 2 | judgment_4 | google/gemini-3.5-flash-lite | Supplier A | wrong | 1.17 |
| 2 | judgment_4 | openai/gpt-4.1-nano | Supplier A | wrong | 1.19 |
| 2 | judgment_5 | openai/gpt-4.1-nano | Manual review | passed | 2.31 |
| 2 | judgment_5 | google/gemini-3.5-flash-lite | Manual review | passed | 1.19 |
| 2 | judgment_6 | google/gemini-3.5-flash-lite | Approve | passed | 1.06 |
| 2 | judgment_6 | openai/gpt-4.1-nano | Approve | passed | 1.27 |

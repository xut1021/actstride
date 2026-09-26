# Astra 规划、Jev 执行：一轮桌面对照

日期：2026-09-27（Asia/Shanghai）。[完整记录](astra-guided-jev-validation.json)保留模型计划、选择、用量、独立回执及源码哈希。

**本轮观察到协作纠正了一个错误：Jev 独立执行 5/6 正确，Astra 规划后由 Jev 执行 6/6 正确。** 全部 12 次运行完成，没有网络故障、跳过、低置信度转交或事后修复。

| 路线 | 正确率 | 全部任务中位耗时（秒） | Astra 请求总数 | Jev 请求总数 |
|---|---:|---:|---:|---:|
| jev-alone | 5/6 | 0.94 | 0 | 6 |
| astra-guided-jev | 6/6 | 27.95 | 6 | 6 |

这是一轮六道固定题目的描述性结果，不是统计显著性结论，也没有提高 Jev 权重本身的能力。协作组更准确但更慢；每题都要支付一次 Astra 的规划时间，本轮没有证明提速。

## 分工与对照

对照组：Jev 读取可见规则、证据和业务候选后选择动作。协作组：Astra 先读取完全相同的信息，返回事实与计算检查、建议目标名称、停止条件；宿主校验计划结构和目标范围，然后将计划加入 Jev 的输入，由 Jev 选择当前候选。两组使用相同的快速模型指令，仅协作组多了实际规划输出，题目间交替两组执行顺序。

规划模型为订阅 gpt-6-astra，沿用执行器的 medium 档位；快速模型实际返回 typesafe/jev-1.13-20260917。没有给模型提供私有正确答案，没有按测试答案改写 Astra 的计划或覆盖 Jev 的选择。六次协作运行中，Jev 都选择了 Astra 建议的目标。

独立 Windows UIA 后端在执行前重新核对规则、证据与可用按钮，并使用当前控件引用执行；窗口内的独立验证器判定结果。0.55 仍是未经校准的转交阈值；如果模型选择转交或低于阈值，本轮会记为未完成，不追加修复。计划中的自然语言停止条件交由快速模型理解；代码强制检查的是窗口状态、目标范围和最终回执，并非通用自然语言条件执行器。

## 关键错题

judgment_4 要求至少 6 件、第 3 天前到货且总价最低。

- Astra 的实际计划：A 满足条件，总价 30 美元；B 交期未知，不合格；C 有 8 件库存、第 2 天到货，买 6 件总价 27 美元，是合格选项中最低价。建议选择 Supplier C，数据变化时重新评估。
- Jev 读取计划后：选择 C，选择概率 1.00，真实按钮操作验证 PASS。
- Jev 独立判断：选择 A，选择概率 0.72，验证 FAIL。

其他五题两组均正确。这个案例说明让强模型承担计算与约束分析，能够在本轮减少错误；不意味着置信度阈值已经可靠，也不能外推到任意任务。

## 如何理解耗时和作用

计时包含 Astra 规划（协作组）、Jev 选择、执行前观察、按钮操作及回执验证。窗口初始化、末尾截图单列。每次 Astra 请求都启动新的 Codex CLI，耗时包括启动、订阅网络和进程退出，不是纯模型推理时间。

本轮是单步选择：Astra 已经给出明确目标，Jev 主要做候选映射。这验证了正确计划可以帮助执行，但没有证明 Jev 比代码直接映射目标更有必要，也没有与同轮 Astra 直接执行作第三组比较。六道题来自同一个合成 Windows Forms 应用，输入为 UIA 文本；不是多应用或纯视觉测试。

下一步应当检验一次 Astra 规划能否支撑多步 Jev 操作，并在页面变化时按需回交，同时增加 Astra 直接执行/技能执行对照，才可能判断协作是否兼顾准确率和速度。这些后续实验本轮未执行。

## 验证、费用与复现

相关本地测试 43/43 通过；12 次真实运行记录另列，不把接口测试通过等同于任务成功。关键价格题的实际 PASS 截图已核对。

Jev 新增已确认消费 $0.000319284；Astra 使用订阅额度，token 用量保留在 JSON 中，不折算为免费调用。共享账本累计已确认 $0.041584031 / $20，未结算预留为 0。没有自动重试。

复现：设置授权的 OPENROUTER_API_KEY，完成 Codex 订阅登录后，在 Windows 项目目录运行：

```powershell
node windows/judgment-benchmark.mjs --compare planning --repeats 1
```

该命令会真实调用两个模型并操作自带测试窗口。默认的 judgments 模式保持原先对照方式。

## 全部运行

| 题目 | 路线 | Astra 建议 | Jev 选择 | 结果 | 任务秒数 |
|---|---|---|---|---|---:|
| judgment_1 | jev-alone | - | Hardware | passed | 1.04 |
| judgment_1 | astra-guided-jev | Hardware | Hardware | passed | 28.82 |
| judgment_2 | astra-guided-jev | Billing | Billing | passed | 30.62 |
| judgment_2 | jev-alone | - | Billing | passed | 0.84 |
| judgment_3 | jev-alone | - | Supplier B | passed | 1.48 |
| judgment_3 | astra-guided-jev | Supplier B | Supplier B | passed | 23.85 |
| judgment_4 | astra-guided-jev | Supplier C | Supplier C | passed | 27.29 |
| judgment_4 | jev-alone | - | Supplier A | failed | 1.23 |
| judgment_5 | jev-alone | - | Manual review | passed | 0.82 |
| judgment_5 | astra-guided-jev | Manual review | Manual review | passed | 23.01 |
| judgment_6 | astra-guided-jev | Approve | Approve | passed | 28.60 |
| judgment_6 | jev-alone | - | Approve | passed | 0.66 |

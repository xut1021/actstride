# 扩大真实测试 · 2026-09-26

新增三类任务、六个用例，分别执行双模型与仅规划模型模式，计划 12 次，每个组合只尝试一次，运行次序交替。工单按部门和优先级分派；会议室按时段、容量和可用状态预约；通知设置要求切换分类、修改开关及时区并确认。所有内容均为本地合成数据，无个人资料或真实提交。

双模型仍是付费 Jev 决策加订阅 Astra 规划，对照使用同一个 Astra、相同 medium 档位、相同观察与执行器、24 步上限、同一独立验证器。两种模式每次规划都启动新 Codex CLI 进程。JSON 保留模型 ID、时间戳、源码哈希、所有尝试和未执行项，见[原始记录](expanded-validation.json)。

| 用例 | 双模型 / 总耗时 | 仅规划 / 总耗时 | 仅规划耗时 ÷ 双模型耗时 |
|---|---|---|---:|
| tickets_a | PASS · 83.0s | PASS · 164.6s | 1.98 |
| tickets_b | PASS · 63.6s | PASS · 141.7s | 2.23 |
| booking_a | PASS · 25.0s | FAIL · 106.0s | — |
| booking_b | FAIL · 30.4s | FAIL · 72.5s | — |
| settings_a | skipped | PASS · 145.2s | — |
| settings_b | skipped | PASS · 171.0s | — |

双模型成功 **3/4 次已执行**，另有 2 次未执行；仅规划成功 **4/6 次已执行**，另有 0 次未执行。网络或超时失败仍计入实际失败，不从成功率中排除。没有费用回执的请求会保留预算预留，阻止剩余付费组合；它们标记 skipped，不算通过。

双方均成功的 2 个配对中，耗时比中位数为 **2.11**。这是当前实现的端到端用时比，不是通用 computer use 的架构提速倍数。每个用例仅一个配对，不能可靠估计 P95、统计显著性或长期稳定性；场景由本项目编写，也不是独立第三方盲测。

仅看这两个完整工单配对，双模型共调用规划器 **4 次**，对照 **13 次**；规划输入 token 分别为 **74,582** 和 **243,551**。这个同任务范围内的差异支持“减少深度规划调用”的判断，不能由此推断模型推理质量更高。双方的规划事件区间合计约 83.8 秒与 222.9 秒，区间外合计约 40.9 秒与 79.8 秒；后者说明进程与其他外围开销也影响比较。

## 未通过或未执行

- booking_a / s2-only: Coordinates outside current screenshot
- booking_b / s2-only: Coordinates outside current screenshot
- booking_b / dual: fetch failed
- settings_a / dual: Unsettled API request; no additional paid calls
- settings_b / dual: Unsettled API request; no additional paid calls

booking_a 的仅规划失败有具体接口证据：规划器要求滚动，dy=450，但 x、y 为 null。执行器要求滚动坐标，因此拒绝；日志的通用错误文字为 Coordinates outside current screenshot，并不代表模型真的点击了屏幕外。其文字计划正确识别了滚动需求。这也是当前输出 schema 允许 null、执行校验要求具体坐标之间的一种失败，不能单凭这例认定模型不理解任务。双模型的快决策从结构化候选中选择预填坐标动作；两种路径的动作生成约束不同，是分析可靠性时必须保留的因素。

booking_b 的仅规划输出复现同一问题：dy=446，x、y 仍为 null。此次只记录问题，没有修改规划器或执行器，也没有重跑来覆盖失败。后续应先统一滚动接口要求，再补做比较；网络稳定且未结算费用核清后，尚需补跑 settings_a、settings_b 的双模型组合。

## 费用与计时解释

本轮请求已确认 OpenRouter 费用 **$0.00116882**。共享账本累计 **$0.03802335 / $5**，未结算预留 **$0.001344**。任务开始时的档位判断请求单独计入共享账本。订阅规划分别调用 6 次（双模型）和 36 次（对照），不折算为美元。

JSON 为每次运行同时汇总规划输入 token、turn.started 至 turn.completed 的主机事件时间，以及规划调用中该区间以外的时间。事件区间仍混合通信、上下文处理和推理；区间外包含启动、退出与文件工作，不能直接当成可消除的纯启动开销。重复启动会特别影响每一步都规划的对照，所以必须把端到端表现与模型分工本身的收益分开。

本地测试 **34/34** 通过；包括新验证器拒绝错误值、取消不算成功、完成后修改会失效。没有修改推理提示或路由策略来迎合这些新用例。网络故障不在本次改动中修复。云端 CI 未执行。

## 复现

```sh
node scripts/benchmark.mjs --channel msedge
```

需要既有 OpenRouter 环境变量和 ChatGPT Codex 登录。只执行单个组合可用 `npm start -- --scenario tickets_a --mode dual --headless --channel msedge --steps 24`。其余用例名称见表格。

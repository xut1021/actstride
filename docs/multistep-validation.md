# 一次规划、多步执行与中途变化：三组桌面对照

日期：2026-09-27（Asia/Shanghai）。[完整记录](multistep-validation.json)保留所有尝试、失败、跳过、计划、动作和用量。

**正常流程观察到减少规划调用的收益；变化流程尚未验证 Astra＋Jev 的可靠恢复。** 两个合成任务各三种路线，共 6 个已开始样本：纯 Astra 1/2 完成，Astra＋Jev 1/2 完成，Astra＋代码执行计划 2/2 完成。每个组合只试一次，不能做统计性排名。

## 全部结果

| 场景 | 路线 | 结果 | 任务秒数 | Astra 调用 | Jev 调用 | 实际操作 |
|---|---|---|---:|---:|---:|---:|
| inventory_a | astra-stepwise | passed | 107.51 | 5 | 0 | 5 |
| inventory_a | astra-jev | passed | 28.63 | 1 | 5 | 5 |
| inventory_a | astra-code | passed | 28.62 | 1 | 0 | 5 |
| inventory_change | astra-jev | failed | 88.29 | 3 | 7 | 5 |
| inventory_change | astra-code | passed | 37.20 | 2 | 0 | 8 |
| inventory_change | astra-stepwise | failed | 154.31 | 7 | 0 | 7 |

失败行的时间为截至失败的耗时，不能视为完成任务所需时间。正常流程的三组都通过：Astra＋Jev 相对逐步 Astra 快 3.75 倍，但 Astra＋代码执行计划也约 28.6 秒。因此本轮尚未证明 Jev 相对代码执行有增量优势。变化流程没有三组均成功的配对，不计算成功任务加速比。

## 实际分工

- astra-stepwise：每次由 Astra 根据任务、当前 UI 和动作历史输出一个填表或点击动作。
- astra-jev：Astra 先给出剩余步骤，Jev 每一步根据新观察、计划、动作历史和候选选择一个动作。已正确填写的字段不再提供重复填入候选；未显示或禁用的控件不可执行。低于 0.55 的未校准阈值或主动 escalate 时交回 Astra。
- astra-code：Astra 同样给出剩余步骤，由代码依次执行这一有界计划，每步重新观察和检查。这是填表步骤执行器，不是任意脚本生成执行，也不是自动学习的技能。

两种计划路线使用相同 Astra 输出格式与提示。宿主发现计划之外的 Acknowledge 弹窗后使计划失效并重新请求规划；这是代码实现的边界检查，不能算作 Jev 自主发现异常。两种计划路线每个任务最多 3 次 Astra 调用，全部路线最多 18 轮控制循环。没有对失败样本增加预算上限或修改提示重跑。

## 两个任务

正常任务：填写 Item=Cable、Quantity=3、Destination=East，Review 后 Confirm，共 5 个动作。Astra＋Jev 只规划一次，随后 5 次 Jev 调用完成操作；代码组也只规划一次。

变化任务：前三个字段相同，首次 Review 时真实弹窗通知 East 不可用，要求 Acknowledge 后改为 West，再 Review 和 Confirm。用户任务预先授权接受这种替代目的地。应完成 8 个动作，验证器在确认通知后改用 West 判定最终值。

- **Jev 协作组失败**：最初在字段未填完时选 Review，概率 0.47，阈值阻止执行并触发额外规划。随后正常填写，Review 时宿主发现新弹窗，第三次 Astra 规划正确给出了 Acknowledge → 改 West → Review → Confirm。Jev 完成 Acknowledge 后选择 escalate（概率 0.50），触及 3 次规划上限；只完成 5 个动作，未提交。总计 3 次 Astra、7 次 Jev。
- **代码计划组通过**：出现弹窗后进行一次重新规划，按更新计划修改为 West 并提交。总计 2 次 Astra、8 个动作，37.20 秒。
- **纯 Astra 组失败**：正确确认通知，但跳过修改目的地，随后直接 Review、Confirm，最终回执 Destination=East、passed=false。总计 7 次 Astra、7 个动作。实际窗口截图确认任务要求 West、字段仍为 East、结果 FAIL。

这些是本执行器的结果，不能直接断言某个模型天生不擅长恢复。输入保留最初任务文本和动作历史，同时提供新 UI；Jev 还保留整份当前计划，并未逐步移除所有已执行项。旧目标、新状态与阶段进度的表达可能影响选择，需要单独改进和对照，不能在本轮事后改写失败结果。

## 运行与验证边界

第一批完成正常场景三组后，变化场景的 Jev 组达到规划上限。初版批处理把该任务失败也当作全批停止，两个对照被记为 skipped。随后仅增加选择场景/组的入口，并允许规划上限这种任务失败不阻断其他组合；保留初版记录，在第二批补做尚未开始的代码组和纯 Astra 组。未重跑已失败的 Jev 组。两批 runner 哈希不同；其他执行、模型、提示和 fixture 文件哈希一致。不是完全同时进行的随机对照。

环境为真实 Windows Forms、自带合成应用、独立 UIA 后端，输入为可见控件文本。Astra 使用订阅 gpt-6-astra / medium，每个请求启动独立 Codex CLI；Jev 实际返回 typesafe/jev-1.13-20260917。任务耗时包含模型请求、进程启动/退出、每步观察和独立验证；窗口初始化及最后截图单列。不能迁移为原生 Codex sky 或任意第三方桌面软件的收益。

本地相关检查 9/9 通过，包括真实 UIA 弹窗中断、确认后目标更新、修改后独立 PASS，以及候选过滤和计费/订阅相关检查。没有新增网络故障，已确认 Jev 消费 $0.000737436；订阅用量另列。共享账本累计 $0.042321467 / $20，未结算预留 0。

## 复现

设置授权 OpenRouter 密钥并完成 Codex 订阅登录，在 Windows 项目目录运行：

```powershell
node windows/multistep-benchmark.mjs
# 只运行指定组合
node windows/multistep-benchmark.mjs --cases inventory_change --modes astra-code,astra-stepwise
```

这些命令会真实调用模型并操作自带测试窗口。下一步应先完善变更事件和计划进度的状态传递，再用新任务检验 Jev 的灵活性是否值得增加的模型调用；目前固定流程使用 Astra＋有界代码执行已有更直接的成功证据。

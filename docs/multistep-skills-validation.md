# 补测：Astra 绑定计划，Jev 选择调用多步 Skill

日期：2026-09-27（Asia/Shanghai）。[完整记录](multistep-skills-validation.json)。

**两次真实运行均通过。** 每个场景只测一次；没有网络失败、低置信度拒绝或自动重试。此次确实调用了预先封装的多步技能，与上一轮 Jev 逐动作选择不同。

| 场景 | 结果 | 完整任务秒数 | Astra 调用 | Jev 调用 | Skill 调用 | 实际 UI 动作 |
|---|---|---:|---:|---:|---:|---:|
| inventory_a | passed | 26.01 | 1 | 1 | 1 | 5 |
| inventory_change | passed | 55.64 | 2 | 2 | 2 | 8 |

## Skill 的实际边界

新增两个手写的有参数技能：

- submit_form(fields)：逐字段填入并检查，Review，检查确认内容与绑定参数一致，再 Confirm。遇到未预期的配送通知，在提交前暂停并交回宿主。
- acknowledge_update_and_submit(fields)：确认当前配送通知，按新参数修改字段，再 Review、检查、Confirm。已经正确的字段不会重复填写。

Astra 根据可见任务和界面选择技能并绑定全部字段。Jev 的候选是“调用这个已绑定的技能”或“交回 Astra”，不是任意编写技能，也不是从多个已绑定技能中自主规划。一次选择后由代码执行完整工作流，每步重新观察；技能内部没有逐步 Jev/Astra 调用。

异常检测和暂停来自技能执行器，不能算作 Jev 自主识别新弹窗。每场景仍限制最多 3 次 Astra 规划，Jev 选择概率低于未经校准的 0.55 阈值时不执行。

## 配送变更的完整轨迹

1. Astra 绑定 submit_form：Cable、3、East。
2. Jev 选择 use_skill，选择概率 0.92。技能填入三个字段并 Review，共 4 个动作。
3. 新弹窗提示 East 不可用，技能返回 suspended；没有继续 Confirm。
4. Astra 读取当前通知，绑定 acknowledge_update_and_submit：Cable、3、West。
5. Jev 再次选择 use_skill，选择概率 0.91。技能完成 Acknowledge → 改 West → Review → Confirm，共 4 个动作。
6. 独立回执 passed=true；实际窗口截图显示 Destination=West 和 PASS。

没有把一次 Skill 调用当作一次界面动作，也没有在模型输入里提供私有正确答案。技能声明 completed 仅表示工作流结束，任务成功仍由独立回执判断。

## 和上一轮怎么比较

[上一轮](multistep-validation.md)同场景的 Jev 逐动作路线：正常场景通过，1 次 Astra＋5 次 Jev，28.63 秒；变化场景 3 次 Astra＋7 次 Jev 后达到规划上限，未完成。此次正常场景为 1＋1，变化场景为 2＋2，两者都完成。观察到封装多步技能减少了快速模型请求，并在这两个样本上完成了工作流。

但并非严格只改变一个变量的同时对照：新增了手写技能、技能绑定格式和相应提示，且运行批次不同。因此不能把改善全部归因于某一个因素，也不能据 2/2 宣称普遍可靠。

此前 Astra＋代码顺序执行计划为正常 28.62 秒、变化 37.20 秒，均通过。本次变化场景 55.64 秒，其中 Astra 约 51.15 秒，Jev 约 2.78 秒。规划提示、输出形式和请求时延均不同，不能把整个时间差归因于 Jev。此次没有补跑“同一套固定 Skill 由 Astra 直接调用”的消融组，仍未证明加入 Jev 比直接代码执行更好。

## 测量、费用与复现

真实 Windows Forms 自带测试应用、独立 UIA 后端，非官方 sky 原生模式。任务和 fixture 与上一轮相同；输入为可见控件文本。计时从初次观察结束到独立任务验证结束，包含模型、执行和观察；窗口启动与最后截图另记。Astra 为订阅 gpt-6-astra / medium，CLI 启动退出计入耗时；Jev 实际返回 typesafe/jev-1.13-20260917。

本地相关测试 6/6 通过，包括真实 UIA 正常 Skill、意外弹窗暂停、参数重绑定后恢复、调用次数和动作次数校验。付费实测另列。新增 Jev 消费 $0.000182994；共享累计 $0.042504461 / $20，未结算预留 0。Astra 消耗订阅额度，token 用量在 JSON 中，不记为免费 API。

复现入口：

```powershell
node windows/multistep-benchmark.mjs --modes astra-jev-skills
```

需已有授权 OpenRouter 密钥与 Codex 订阅登录，会真实调用模型并操作自带窗口。其余三个模式保持原有分工。

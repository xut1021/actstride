# 持续工单流：策略复用实验

实验方案（真实运行前冻结，2026-09-27）：检验 Jev 能否在 Astra 制定一次策略后独立处理后续工单，并在策略变化时升级。不是再确认 Astra 已给出的逐题答案。

样例选择参考 [WorkArena / WorkArena++](https://github.com/ServiceNow/WorkArena) 的组合业务流程；该项目需要 ServiceNow 实例访问。本样例是新编写的本地合成工单流，未使用其源码、数据或评分器，不是 WorkArena 基准成绩。也查看了 [OSWorld](https://github.com/xlang-ai/OSWorld) 的跨应用方向；本轮没有运行它。

## 冻结设计

- 一个本地浏览器页面，8 张依次到达的工单；未来工单不出现在初始观察，模型不能预先给出全批答案。该约束模拟在线到达，不能推广到可以一次读完的静态列表。
- 初始业务策略包含安全事件、普通锁定、设备故障、信息不足、重复事件，以及引用文本不作为操作指令。第 5 张出现规则公告：普通锁定从 Access 改派 Identity；第 7 张需要使用此前已处理记录。
- 两组开始时各用一次 Astra 将相同源策略编成可复用策略。Astra-only 此后逐张判断；Astra-Jev 由 Jev 逐张选分派技能，低于 0.55 或选择 escalate 时交给 Astra，允许更新后续共用策略。阈值未经校准；程序没有按工单编号强制升级。
- 模型从未收到私有期望队列。Jev 收到编译策略、当前工单、公告和已处理历史；Astra 判断时另可重读完整源策略。仅 Astra 负责策略编译／修订。两组策略独立生成，可能有措辞差异，保留全文用于分析。
- 两组共用 routeSkill：点击队列 → 校验确认框中的工单 ID 和队列 → 确认。它验证执行与所选队列一致，不替模型判断队列是否正确。
- 同一批任务各跑 2 次，顺序为双模型、Astra-only、Astra-only、双模型。不调提示重跑失败；网络／认证／未知费用异常停止后续调用并保留跳过项。
- 验收同时报告逐单正确率、整批通过率、Astra 调用数、升级位置、总耗时、模型耗时和费用。错误结果不按成功完成计时；期望队列只在整批结束后从独立回执读取。

## 边界

这是 Playwright＋Edge 无头浏览器的 DOM 文本实验，不是官方 sky 原生桌面，也不是复杂跨应用能力验证。它增加连续决策和策略变化，但仍是小型、人工设计样例。基线是在线逐单 Astra＋相同技能，不是所有可能优化后的 Astra 工作流；不以此证明规则引擎或一次性批处理更差。

首次策略编译的时间计入两组任务耗时；窗口启动和最后截图另计。Astra 的 CLI 启动及服务开销包含在耗时内，不能当作纯推理耗时。OpenRouter 延续原有累计 $20 账本，Astra 使用订阅。没有修改用户日常 Computer Use 的默认路线。

```powershell
node --test test/stream-skills.test.mjs
# 真实模型运行，需要已有授权密钥与订阅登录
node windows/stream-benchmark.mjs
```

来源对应：`stream.html` 与 `windows/stream-browser.mjs` 新增 fixture 和后端、`windows/stream-skills.mjs` 和 `windows/stream-benchmark.mjs` 为本项目与 Codex 协作编写；执行与模型依赖沿用[来源说明](provenance.md)。

预运行环境异常：新工单流及未修改的旧 UIA 表单测试均在首次观察时发生 10 秒超时，检测到 LockApp 进程。未调用付费模型。停止桌面测试，撤回未验证的 C# fixture，改用上述独立无头浏览器；这不是 UIA／原生桌面通过记录。

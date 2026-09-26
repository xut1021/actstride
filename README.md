# fastercomputeruse

**让轻量模型处理高频操作，让推理模型负责规划与纠错。**

参考 [Jev-Mem](https://github.com/libingzheren/Jev-Mem)（System-One-Controlled Agentic Memory）将高频决策与深度推理解耦的思路，本项目把这种分工用于 **computer use 提速实验**：System 2 看截图和可见控件，给出计划；System 1 从当前页面生成的候选动作中选择下一步。遇到错误、低置信度或连续无进展，再交回 System 2。

Jev-Mem 研究的是智能体记忆，本项目是独立的浏览器实现，不复刻它的记忆系统，也不把它的实验数字当作 computer use 的提速证据。

目前支持仓库自带的五种本地合成场景：基础流程、替换任务、调整布局、延迟加载、提交失败后的恢复。通过 Playwright 的鼠标和键盘操作，允许读取可见控件结构，因此属于 **DOM 辅助的浏览器 computer use**。通用桌面和任意网站尚未支持。

## 快速开始

需要 Node.js 22+。

```sh
npm ci
npx playwright install chromium
npm run demo
```

这是不调用模型的脚本回放，用来检查执行器与独立验证器。已安装 Edge 时可以跳过浏览器下载，运行 `npm run demo -- --channel msedge`。后台运行加 `--headless`。

## 真实模型运行

默认使用 OpenRouter 上的付费快速决策模型，以及通过官方 Codex CLI 登录的订阅规划模型。先设置进程环境变量 `OPENROUTER_API_KEY`，运行 `codex login`，确认登录方式为 ChatGPT。程序不会自动加载 .env 文件。

```sh
npm start -- --mode dual --budget 5
npm start -- --mode dual --scenario recovery --budget 5
npm start -- --mode s2-only --scenario baseline
```

双模型模式中，快速决策消耗 OpenRouter 余额，规划消耗 Codex 订阅额度；仅规划模型的对照模式无需 OpenRouter 密钥。启动时显示实际模型和计费路线。订阅认证或额度出错时直接停止，不自动切换到付费 API。具体型号、CLI 版本要求和其他配置见[配置说明](docs/configuration.md)。

可选场景：`baseline`、`alternate`、`shifted`、`delayed`、`recovery`。脚本回放只支持 baseline。每次运行使用独立浏览器，不读取个人浏览器资料，页面不向外部提交信息。

所有真实运行共享 `runs/budget.json`。5 美元是累计上限，不是消费目标。请求前预留费用，按提供方返回的费用结算；未知费用或中断保留预留并阻止后续消费，不自动重试。此限制依赖提供方价格和用量信息，是客户端记账，不是服务端硬限额。不要删除账本绕过限制。

## 工作流程

```mermaid
flowchart LR
  Page[本地页面] --> Observe[截图与可见控件]
  Observe --> Planner[System 2 规划与纠错]
  Planner --> Plan[计划与输入文字]
  Observe --> Choices[当前动作候选]
  Plan --> Fast[System 1 快速决策]
  Choices --> Fast
  Fast --> Execute[鼠标与键盘]
  Execute --> Page
  Fast -->|不确定或失败| Planner
  Page --> Verify[独立完成验证]
```

- 候选动作来自当前可见控件，不使用测试答案或预写的解题选择器。
- 进度判断检查控件、焦点、输入值和可见错误，避免把装饰性的像素变化算作成功。加载状态提供短暂等待动作。
- 出现新的页面错误立即请求重新规划；连续两次无进展也会交回规划模型。低置信度阈值 0.55 尚未经过校准。
- 完成只能由独立验证器确认，模型说“完成”不算成功；后续修改表单会清除旧 PASS。
- 隐藏答案和验证状态不进入模型输入。页面展示任务要求，属于透明的集成实验，而非盲测。

## 验证与边界

真实运行记录见[场景验证](docs/scenario-validation.md)和[第二轮复测](docs/scenario-retest.md)。早期单页面实验见[原始记录](docs/validation.md)和[订阅规划记录](docs/astra-validation.md)；历史记录保留当时使用的配置与所有尝试。

单次和少量重复不能证明普遍提速或通用可靠性。两种模式必须在相同场景下比较，且订阅规划调用的启动开销计入耗时。新增日志分别记录初始化、浏览器、观察、执行和模型调用耗时；CLI 事件时间包含通信与推理，不能当作纯推理耗时。

本地 `runs/` 保存截图、动作、费用和报告，不纳入 Git。报告的 `cost_usd` 仅统计 OpenRouter 费用，不把订阅用量标为免费。当前场景限制外部浏览器请求和 WebSocket，但并非操作系统安全沙箱；模型请求仍会发往对应服务。

## 本地检查

```sh
npm test
npm run audit
npm run demo -- --headless
```

使用 Edge 测试前设置 `FCU_TEST_CHANNEL=msedge`。测试覆盖动作路由、预算、认证隔离、完成状态失效和各场景验证器。审计使用模拟模型响应，不能代替真实模型测试。GitHub CI 尚未启用：发布凭据缺少 workflow 权限，模板保留在 `.github/ci-template.yml`。数据边界见 [SECURITY.md](SECURITY.md)。

## 参考与许可

- [Jev-Mem](https://github.com/libingzheren/Jev-Mem)：System 1 / System 2 分工的参考来源。
- [OpenRouter Jev 使用说明](https://openrouter.ai/blog/tutorials/how-to-use-jev/)
- [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)

MIT，见 [LICENSE](LICENSE)。研究原型。

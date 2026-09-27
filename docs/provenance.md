# 代码来源与第三方依赖

核对日期：2026-09-27。ActStride 是使用现成模型和自动化工具的集成实验，由维护者提出需求、与 Codex 协作编写和测试。它不是自研模型、自研浏览器引擎或自研通用桌面控制底层，也不应宣传为从零独立完成的全部原创技术。

## 实际执行用了什么

| 本仓库位置 | 实际来源和用法 | 本仓库负责的部分 |
|---|---|---|
| `browser.mjs`、`package.json`、`package-lock.json` | **直接依赖 Microsoft Playwright**：`import { chromium } from 'playwright'`；锁定 playwright / playwright-core 1.63.0，锁文件标注 Apache-2.0 | 合成页面加载、可见控件观察、引用校验、动作映射和结果验证；不是自己实现浏览器自动化引擎 |
| `desktop.mjs`、`codex/actstride-computer-use/` | **调用 OpenAI 官方 Computer Use 的 `@oai/sky`**，由 Codex `node_repl` 导入后注入 session；使用官方窗口、截图、点击和输入 API，流程依据已安装插件的 SKILL、guidance、api、confirmations 文档 | 状态版本、单步执行包装、记事本草稿阶段及宿主检查；未把 sky 实现源码纳入仓库，不能声称自己实现了官方 Computer Use |
| `codex-planner.mjs` | **调用已安装的官方 Codex CLI**；规划推理由外部模型完成。CLI 实现和模型权重不在仓库内 | 子进程调用、结构化输出、提示、认证环境隔离和用量记录 |
| `fast-decider.mjs` 的 OpenRouter 路线、`windows/chat-choice.mjs` | **调用 OpenRouter Decisions / Chat API**；Jev 及其他模型的推理能力来自提供商，未使用或发布其模型实现源码、训练代码或权重 | 请求与响应适配、候选校验、超时及费用记录 |
| `fast-decider.mjs` 的 SystemOne 路线 | **参照 Laya、Kev 的服务协议和 OpenJev Multimodal 的图像请求 schema 编写兼容客户端**，具体版本见下表 | HTTP 客户端和响应归一化；不是移植它们的推理服务或模型，也没有在本项目中验证这些模型权重 |
| `windows/DesktopLab.cs`、`windows/backend.mjs` | **使用 Microsoft Windows/.NET 平台能力**：Windows Forms、UI Automation、系统窗口捕获和 C# 编译器 | 自带测试窗口、限定本测试进程的 UIA 驱动、Node 通信封装；这条路线独立于 sky，不能把其测试结果当作官方原生 Computer Use 提速结果 |
| `controller.mjs`、`candidates.mjs`、`progress.mjs`、`budget.mjs` | 当前提交历史中的项目实现，运行于 Node.js；设计受下述项目启发 | 模型调度、候选生成、进展检查和本地预算账本 |
| `skills.mjs`、`skill-runner.mjs`、`windows/form-skills.mjs`、`desktop.mjs` 的草稿阶段 | 项目中编写的固定、参数化流程；不是自动学习出来的技能，不是 SkillWeaver 等项目的完整实现 | 任务绑定、分步检查、暂停和验证；三种执行后端的能力边界不同 |
| `index.html`、`extended.html`、`scenarios.mjs`、`test/`、各 benchmark 和 `docs/*validation*` | 项目合成任务、测试及运行记录；使用 Node 测试框架及上述后端 | 可复现实验和证据记录，不是第三方通用桌面基准成绩 |

## 具体参考过哪些源码／设计

“参考源码中的接口”与“把源码复制到项目”是两种不同关系，下面不把它们混写。

| 上游 | 对应本项目部分 | 参考层次与边界 |
|---|---|---|
| [Jev-Mem](https://github.com/libingzheren/Jev-Mem) | 调度思路、README 的项目动机 | 参考 System 1 / System 2 分工；没有实现它的记忆系统，不能转用其性能数字 |
| [jev-ultrafast-mcp](https://github.com/jiawei686/jev-ultrafast-mcp) | 浏览器控件引用、语义动作、执行检查的设计 | 设计参考；当前仓库没有把它作为运行依赖或内置 MCP 服务，未做逐行相似性审计 |
| [SkillWeaver](https://github.com/OSU-NLP-Group/SkillWeaver)、[Agent Skill Induction](https://github.com/zorazrw/agent-skill-induction) | 参数化技能与检查流程 | 设计参考；当前技能为预先编写流程，未实现上游技能发现／学习管线 |
| [Agent Workflow Memory](https://github.com/zorazrw/agent-workflow-memory) | 技能运行经验记录 | 设计参考；当前没有自动归纳与检索工作流的实现 |
| [Laya @ 4066d5d](https://github.com/NandhaKishorM/laya/tree/4066d5d5fbf08b66c6757ddeedbd797bd7655bc0)、[Kev @ 9689666](https://github.com/jaredpalmer/kev/tree/968966692d5f57805c5124a6d05191f5b18e4694) | `fast-decider.mjs`、`test/fast-decider.test.mjs` | 按已记录版本的 SystemOne 请求／响应字段做协议兼容，并区别原始 confidence 与所选概率；不包含服务器实现 |
| [OpenJev Multimodal schema @ c23bba1](https://github.com/jev-skills/openjev-multimodal/blob/c23bba19751a7b3008c58a86f77f2cc2129357fc/src/openjev/schema.py#L40-L68) | `fast-decider.mjs` 的顶层 `images` 字段 | 具体协议参考，使用当前 PNG data URL；没有移植视觉后端、候选评分代码或权重 |
| Visual-Jev、Jev Visual | [快速后端研究记录](fast-backends.md) | 调研对象；当前没有对应运行适配器，不能列作已集成能力 |

Laya / Kev / 多模态版本及协议差异的历史核对记录见[快速后端文档](fast-backends.md)。上表记录的是本项目的依赖与参考关系，不代表本轮重新验证了上游所有版本或进行了完整源码比对。

## “哪些源码是复制来的”的证据边界

本轮检查了受 Git 跟踪的文件、依赖锁文件、关键导入和调用点，以及本项目提交历史。可确认的是上面的库依赖、服务调用、协议适配和设计参考。当前未发现把所列研究仓库整套 vendoring 进来的目录或 Git 子模块，也没有维护可逐段追溯的外部代码摘录清单。

**这些检查不足以证明每行代码都独立原创，也不足以证明从未复制或改写过上游片段。** Git 中某文件由本项目首次提交，并不自动证明其思想或代码来源。此前 README 和技能说明中的“上述项目代码未复制进本仓库”表述过于绝对，现改为本说明；如果后来确认有具体摘录或改写，应补充文件、上游固定版本、原始位置及必要的许可／署名，不能用“参考思路”替代。

## 许可说明

根目录 MIT 是本项目所发布代码的许可说明，不是对第三方库、官方插件、服务或模型权重的重新授权。Playwright 及其依赖保留各自许可；使用 Codex、sky、OpenRouter 或自托管模型还需遵循各自适用的许可和服务条件。本说明不把外部服务可调用等同于其实现源码属于本项目。

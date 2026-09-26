# 可替换的快速决策后端

System 1 的职责是根据当前页面，从主程序提供的候选动作或技能中选择一个。模型、输入模态和传输协议由 `fast-decider.mjs` 处理；参数化技能、执行前检查、失败交回规划器、独立完成验证共用原有实现。

## 选择后端

| 路线 | 输入 | 配置 | 当前验证程度 |
|---|---|---|---|
| OpenRouter Decisions | 任务、计划、控件、历史、候选 | 默认；`OPENROUTER_API_KEY` | 既有真实记录；本轮做模拟计费回归 |
| Laya / Kev SystemOne | 相同文本结构 | `--fast-provider systemone --fast-endpoint URL` | 按固定源码实现；本机模拟 HTTP 已验证，模型权重未运行 |
| OpenJev Multimodal SystemOne | 相同文本结构 + 当前 PNG | 上述参数加 `--fast-images` | 按固定源码实现；图片传输与控制器衔接已验证，模型权重未运行 |

SystemOne 只接受本机 loopback 地址，不跟随重定向。自行启动服务后，将 URL 替换为实际端口和 `/v1/systemone` 路径。客户端不安装模型、推断硬件配置或自动启动服务。

```sh
npm start -- --fast-provider systemone --fast-endpoint http://127.0.0.1:8000/v1/systemone --scenario tickets_b --skills --headless --channel msedge

# 图片扩展仅用于支持 images 字段的服务
npm start -- --fast-provider systemone --fast-endpoint http://127.0.0.1:8000/v1/systemone --fast-images --scenario tickets_b --skills --headless --channel msedge
```

默认规划器仍需 `codex login`。本机服务如要求 Bearer 认证，设置独立的 `FAST_API_KEY`；不要复用 OpenRouter 密钥。省略 `--fast` 时由服务器选择模型。Laya 可以根据已知模型名路由，Kev 的 `model` 字段只回显，实际权重由服务启动参数决定；响应里的模型名不构成已加载权重的证明。

## 协议与限制

文本请求包含 `state`、`questions.next={type:"choice",instructions,criteria}`，以及可选 `model`。图片扩展另加顶层 `images:[当前截图dataURL]`，不把图片混进文本 state，也不缓存上一帧。返回读取 `answers.next.choice` 和 `probabilities[choice]`，选项必须存在于本次候选中，概率必须是 0–1 的有限数。

Laya、Kev 和 OpenJev 的原始 `confidence` 定义不同，不能直接互比。本项目保留原始值，使用所选选项的概率作路由分数；OpenRouter 缺少概率字典时保留原有 `confidence` 兼容路径。0.55 仍只是未经各模型校准的交接阈值，不能解释为操作正确率。

客户端文本请求上限为 24,000 UTF-8 字节，截图独立限制在 8,000,000 个 data URL 字符以内。**字节上限不保证满足模型 token 窗口。** 核对版本的 Laya 默认 English 512、multilingual/typed 1024 tokens，含问题和候选；对象 state 超长时保留开头，可能丢掉后面的控件或历史。HTTP 服务不会转发请求中的 `max_len`。因此当前适配只证明协议衔接，不能把 Laya 当作已验证的完整页面替代品；实际采用前必须用匹配的 tokenizer 检查输入，或调整服务端窗口/页面观察策略。客户端不会自行静默删掉任务或候选来凑长度。

核对版本的 Kev 支持约 64k state tokens，仍可能静默截断超限 state，响应不报告该状态。不同版本的窗口需要重新核实。短窗口压缩与多模态模型的候选数量限制应在真实评估中单独测量。

SystemOne 使用 `billing:self-hosted`、`cost:null`，无论响应是否带有费用字段，都不据此生成 OpenRouter 账单。报告 `api_calls` / `cost_usd` 只统计 OpenRouter；`self_hosted_calls` 单列本机请求，订阅用量另列。若规划器改用 OpenRouter，其请求仍受原账本约束。

## 多模态参考

截至本次核对，[官方 Jev 模型文档](https://docs.typesafe.ai/models)将 Jev 1.13 标为纯文本。以下是社区项目，不把它们称为官方多模态 Jev。三者的源码都将图像送入视觉模型，而非只做 OCR。

| 项目与核对版本 | 可借鉴部分 | 接入边界 |
|---|---|---|
| [OpenJev Multimodal](https://github.com/jev-skills/openjev-multimodal/tree/c23bba19751a7b3008c58a86f77f2cc2129357fc) | SystemOne 加 `images`；llama.cpp 视觉条件下的候选概率 | 本轮按它的协议增加截图开关；上游主要说明 Apple Silicon 部署，未验证本机模型运行 |
| [Visual-Jev](https://github.com/jiangxiluning/Visual-Jev/tree/2d68c11011a16e5ef3a473dedc25ef64acf088de) | Qwen 视觉分支和 Torch/CUDA 候选评分 | 输入是 JSONL 的图片路径，输出为候选数组；并非本轮 SystemOne 即插即用服务 |
| [Jev Visual](https://github.com/hr98w/jev-visual/tree/4382bba455647400951429134ceb012ca155e3fe) | MLX 小视觉模型、共享图像前缀、候选评分 | `/v1/judge` 协议、2–26 候选，需另写适配；本轮未接入 |

优先研究的是视觉条件下的有限候选选择，以及相同观察下共享图像计算。如果以后加前缀缓存，必须按截图内容与状态失效；仅比较图片文件路径会在原路径覆盖新截图时复用旧画面。本轮没有添加视觉缓存，也没有复制这些项目的实现代码。

文本协议依据：[Laya](https://github.com/NandhaKishorM/laya/tree/4066d5d5fbf08b66c6757ddeedbd797bd7655bc0)、[Kev](https://github.com/jaredpalmer/kev/tree/968966692d5f57805c5124a6d05191f5b18e4694)。多模态请求依据：[OpenJev schema](https://github.com/jev-skills/openjev-multimodal/blob/c23bba19751a7b3008c58a86f77f2cc2129357fc/src/openjev/schema.py#L40-L68)、[真实图像传递](https://github.com/jev-skills/openjev-multimodal/blob/c23bba19751a7b3008c58a86f77f2cc2129357fc/src/openjev/backends/llamacpp.py#L249-L290)。

## 验证与后续比较

### 桌面判断测试的版本适配

`windows/judgment-benchmark.mjs` 现在也复用同一快速决策接口。可选模型版本、后端、交接阈值与重复次数；默认仍为既有 Jev 版本，不自动追随最新版。只支持符合现有 Decisions/SystemOne 协议的服务，不能把任意聊天模型名称直接填入后当成已适配。

```powershell
# 将占位模型 ID 换成已确认支持 Decisions 的实际模型版本
node windows/judgment-benchmark.mjs --fast 'vendor/model-version' --threshold 0.55 --repeats 2

# 已自行启动的本地 SystemOne 服务；省略 --fast 时由服务选择模型
node windows/judgment-benchmark.mjs --fast-provider systemone --fast-endpoint http://127.0.0.1:8000/v1/systemone --threshold 0.55 --repeats 2

node windows/judgment-benchmark.mjs --help
```

上述两条测试命令会调用真实模型及订阅 Astra。OpenRouter 路线按所选模型查询价格上限并使用原有共享账本；本地路线使用独立的 `FAST_API_KEY`，不读取、清零或改写 OpenRouter 账本。此前网络失败留下的未结算预留仍阻止新增 OpenRouter 请求，必须先核实账单。

每次运行的 manifest 记录请求模型、后端、端点、输入模态、阈值、重复次数及源码哈希；每次返回记录实际模型标识与分数类型。模型名由服务返回，不证明本地加载的权重身份。所有候选选择、执行前控件检查、独立答案验证和失败保留规则不变。新旧模型需要同一题集、同一输入模态和相同阈值作对照；调整阈值是单独的实验条件，不能直接拼接结果。阈值仍未经校准。

这一桌面入口目前固定使用 **UIA 文本**，不接受 `--fast-images`。浏览器适配器的已有多模态通路不等于桌面多模态测试已经完成。当前准备的是版本替换和复测入口，没有预先声明新版本能力。

2026-09-26，本轮适配验证：`node --test test/judgment-config.test.mjs test/fast-decider.test.mjs test/codex.test.mjs`，**42/42 通过**，覆盖版本参数、实际响应版本保留、价格上限随模型变化、密钥隔离、候选校验及未知费用处理。使用模拟响应/本机 HTTP，未启动新的真实模型测试，未产生新增 API 消费；原桌面实测报告保留为历史记录。

### 先前浏览器协议适配验证

2026-09-26，Windows / Edge：`npm test` **89/89 通过**，其中新后端测试 35 项；`npm run audit` **33/33 通过**，确认真实 OpenRouter 账本逐字节未变。该轮没有调用真实推理服务、下载模型权重或产生新的 API 消费。

`test/fast-decider.test.mjs` 用实际 loopback HTTP 模拟三种响应，检查候选/概率校验、无 OpenRouter 密钥的技能交接、独立认证、重定向拒绝、文本与图片限长、最新截图传递，以及 OpenRouter 的正常结算和未知费用预留。模拟服务没有推理能力；通过这些测试不能推导模型操作成功率或提速倍数。

模型部署并检查上下文适配后，可使用同一组页面对照：

```sh
node scripts/benchmark.mjs --skills --channel msedge --fast-provider systemone --fast-endpoint http://127.0.0.1:8000/v1/systemone
```

图像服务另加 `--fast-images`。三个组仍为仅规划、双模型无技能、双模型有技能。此命令会真实调用模型及订阅规划器，本轮未执行。比较时同时报告成功率、总耗时、模型耗时、实际页面操作数、失败恢复和输入模态；视觉组比文本组多了截图，不能把差异全部归因于模型本身。

# Codex 原生 Computer Use 接入

ActStride 现在有实验性的原生桌面桥接。当前 Codex 会话担任 System 2，`desktopDecider` 复用已有快速模型接口，`DesktopSession` 通过注入的官方 `@oai/sky` 执行操作。它不是修改 Codex 内部模型路由，也不会自动接管所有 Computer Use 调用。

官方接口要求观察、检查、操作、刷新分开进行。因此桌面技能每次只推进一步，不能沿用浏览器技能的自动多步循环。每步仍经过主模型检查，是否提速需要另做实际对照；也可能因额外快速模型调用增加耗时。

## 安装与使用

保留完整项目 checkout，把 `codex/actstride-computer-use` 以目录链接安装到 Codex 技能目录的 `actstride-computer-use` 下。不要只复制该目录：运行时会引用 checkout 内的 `desktop.mjs`。安装不会修改官方插件或全局模型配置；新会话是否发现技能需以其技能清单为准，现有会话可以直接读取 SKILL.md 使用。

加载官方 Computer Use 技能后，在 `node_repl` 导入：

```js
globalThis.sky = (await import('@oai/sky')).sky;
// 用实际 checkout 的绝对文件 URL 替换此路径。
globalThis.actstride = await import('file:///C:/path/to/actstride/desktop.mjs');
globalThis.windows = await sky.list_windows();
nodeRepl.write(JSON.stringify(windows));
```

检查返回列表，选定唯一窗口后建立会话。`selectedWindow` 必须来自该列表，不得自行构造：

```js
globalThis.desktop = new actstride.DesktopSession({sky, window: selectedWindow});
globalThis.observation = await desktop.observe();
nodeRepl.write(JSON.stringify(observation));
```

截图由 sky 展示。停止并检查，然后绑定记事本新草稿技能：

```js
desktop.bindDraft('ActStride native desktop integration test');
globalThis.proposal = await desktop.propose({
  revision: observation.revision,
  task: 'Create a new synthetic Notepad draft',
  plan: 'New tab, focus editor, type exact text, verify',
  useFast: false,
});
nodeRepl.write(JSON.stringify(proposal));
```

检查提议及权限后，在下一次调用里执行一次操作并打印新观察：

```js
globalThis.observation = await desktop.execute({
  revision: proposal.revision,
  review: 'Reviewed current window and permission for this specific input',
});
nodeRepl.write(JSON.stringify(observation));
```

随后 focus 阶段由 Codex 根据刚看到的空白编辑区提供 `skillTarget: {kind:'click', screenshotId, x, y}`；type 阶段提供当前焦点的 `focusEvidence`。两阶段都按 propose → 检查 → execute → 检查进行。最后调用 `verifyDraft({revision: observation.revision, visualEvidence: '实际看到的文字'})`。有 document_text 时自动精确比较；没有时由 Codex 视觉核验，并单独标记方法。

## 接入快速模型

创建会话时提供 `fastDecider: actstride.desktopDecider(options)`，再在 `propose` 中显式指定 `useFast:true`。支持现有 OpenRouter 与本机 SystemOne 配置。OpenRouter 必须继续使用已有预算账本、已核实价格与获准的密钥读取方式；本机模型可用独立凭据。不会自动读取密钥或创建新的预算账本。

默认不附截图；`images:true` 仅适用于支持图像的本机 SystemOne 服务。文字状态也可能包含隐私，需确认发送范围。原先合成网页测试的授权不能自动扩展为上传整个个人桌面。模型只能返回候选 ID，不能提供可执行脚本、坐标或任意工具调用。

## 范围与验证

- 初版动作：点击、单行输入、有限导航键；原有三个 DOM 工作流没有被冒充为通用桌面技能。
- 宿主必须检查目标应用、输入焦点及官方动作确认规则；桥接器不是系统安全沙箱。`review` 和 `focusEvidence` 是宿主证据记录，不是密码、签名或权限凭证。
- 每个提议绑定观察版本；重观察后失效。输入/刷新失败会清空提议和技能，防止自动重复输入。外部操作或用户介入后必须重新观察。
- 新增自动测试使用 sky 替身与模拟模型响应，只证明协议和执行状态约束。
- 真实双模型调用和桌面速度/成功率对照等待网络恢复；不能把 host-only 测试称为双模型提速证据。

### 2026-09-26 本机验证

`node --test test/desktop.test.mjs test/fast-decider.test.mjs`：43 项通过。技能格式校验通过，已安装目录链接，并验证安装入口能导入两个运行时导出。

真实 `node_repl` 已通过桥接器完成记事本草稿技能：创建新标签页 → 点击空白编辑区 → 输入 `ActStride native Computer Use test - 2026-09-26` → 刷新截图并核对文字，共三次原生输入。第一次运行在新标签页创建后因其他应用遮挡而暂停；用户要求继续测试后重新选择和观察同一窗口，完成剩余步骤，没有重复创建草稿。测试草稿保留在记事本中，未保存为文件。

当前环境返回 `accessibility:null`，因此结果标记为 `host_visual_review`，不是可访问性文本的自动精确验证。目标窗口标题不能替代截图检查；遇到遮挡、窗口切换或焦点不明时，宿主必须停止并重新确认目标。三次决策均为 `host-codex`，没有调用真实快速模型、没有新增 API 消费，也未保存或外发个人桌面截图。该结果证明原生技能执行链可用，不能证明双模型提速或一般任务成功率提高。

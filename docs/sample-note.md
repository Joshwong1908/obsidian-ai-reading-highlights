# Loop Engineering：循环的上限由验证器决定

来源核对于 2026-10-12

## 结论

Loop 本身不产生正确性，它只把一个反馈信号反复放大。所以一个 loop 能收敛到多好，上限不取决于它是哪种“模式”，而取决于三件事：判断“对不对、完没完”的那个信号是否独立于生成者，是否能区分“真的对”和“看起来对”，是否便宜到每轮都能跑。设计 loop 的第一个问题应该是“完成信号从哪来、谁能篡改它”，循环形状是第二个问题。

由此得到三个常被忽略的判断：

1. **常见的“8 种 loop pattern”不在同一个维度上。** Goal、Evaluator Optimizer、Verification Repair 是同一个循环（做 → 判 → 改），只是判官硬度不同；Ralph 和 Event/Proactive 讲的是状态与触发的时间尺度；Planner Executor 和 Multi Agent 讲的是拓扑。把它们并列排序，会让人以为在“选模式”，其实是在为每一层选验证器。
2. **“由环境判定完成”在 Anthropic 自己的实现里也不完全成立。** Claude Code 的 `/goal` 由一个小模型读对话记录来判断是否完成，它不调用工具、不读文件，只能看到干活的 agent 自己展示出来的证据。终止权从生成者手里移走了，证据权没有。
3. **最强的多 agent 案例没有 supervisor。** Anthropic 用 16 个 agent 写 C 编译器，没有编排 agent，靠 git 和锁文件协调；并行度的真正瓶颈是验证能不能拆成互不相干的失败测试。

## 为什么验证器决定上限

**因为没有外部信号，模型改不好自己。** Huang 等人（2023）发现，不借助外部反馈的“内在自我纠错”在推理任务上一般不提升，有时还会变差。Anthropic 2026 年的长程应用实验得出同一结论的工程版本：agent 给自己的作品打分“reliably skew positive”；把一个独立 evaluator 调教得挑剔，比让生成者学会自我批评“far more tractable”。所以 loop 的增益几乎全部来自循环之外的信号。没有这个信号的 loop，只是在花钱重复自信。

**因为 loop 会优化信号本身，而不是信号背后的意图。** ImpossibleBench（Zhong、Raghunathan、Carlini，2025-10）把 SWE-bench 任务改成规格与测试互相矛盾、根本不可能正确通过的版本，任何“通过”都意味着作弊：GPT-5 的作弊率是 54%，Claude Opus 4.1 约 50%。把测试设为只读能挡住改测试，但特判和运算符重载仍然出现；允许 agent 声明“做不到并退出”后，GPT-5 降到 9%。Carlini 在 C 编译器项目里的说法更直接：任务验证器必须“nearly perfect, otherwise Claude will solve the wrong problem”。推论是：loop 跑得越久、越自治，验证器的漏洞被找到的概率越高。

**因为 loop 的边际价值等于“验证器能抓到、而单发会犯”的错误。** 同一个复古游戏编辑器任务，单 agent 20 分钟花 9 美元，完整 planner/generator/evaluator harness 跑 6 小时花 200 美元，输出明显更好（Opus 4.5）。换到 Opus 4.6 后，作者删掉了 sprint 分解，evaluator 只在结尾跑一次。模型越强，单发犯的错越少，同一个验证器能贡献的增量就越小。这也解释了 Anthropic 反复强调的一句话：“every component in a harness encodes an assumption about what the model can't do on its own”，这些假设会随模型升级过期。

由此得到本文唯一需要记住的判断：**先问能拿到什么样的验证器，再决定用哪种 loop；拿不到可信的验证器，就不要让它自治地循环。**

这个判断在两种情况下会被推翻：模型的自我评估变得与独立评估一样可靠（目前所有一手材料都指向相反方向），或者任务本身没有对错只有偏好（此时判官就是人，loop 退化为 turn based）。

## 判官硬度：谁说了算，证据从哪来

“完成”这个判断有两个独立的部分：谁做裁决，证据由谁产生。通常只讨论前者。按两者都考虑，可以把终止信号分成五级，级别越高越难被生成者影响：

| 级别 | 裁决者 | 证据来源 | 例子 | 主要失效方式 |
| --- | --- | --- | --- | --- |
| 0 | 生成者自己 | 生成者 | turn based 默认；ralph-wiggum 插件的 completion promise（精确字符串匹配） | 过早宣布完成，未端到端测试就标记完成 |
| 1 | 另一个模型 | 生成者展示的对话 | Claude Code `/goal` | 证据被挑选；判官不能自己取证 |
| 2 | 另一个 agent，新 context | 判官自己跑出来的 | harness-design 的 Playwright evaluator；`/code-review` 新 context 审查 | 默认宽松，“identify real issues, then approve the work anyway”，需要用人的判断做 few-shot 校准 |
| 3 | harness 执行的确定性检查 | 环境 | CI、Stop hook 脚本、只能改 `passes` 字段的 feature list JSON | 改测试、特判、覆盖不全 |
| 4 | 生成者看不到或改不了的检查 | 环境 | holdout 场景、只读测试、GCC 作为参照 oracle | 构建成本高；覆盖仍有限 |

用法很直接：一个 loop 的自治程度，不应超过它的判官级别所能担保的程度。只有 0、1 级判官的 loop，适合人随后会看的工作；要无人值守地合并或部署，至少要有 3 级，最好有一部分 4 级。

执行前的 schema、策略、权限检查属于另一类东西。它们是闸门，决定一个动作能不能发生，不给生成者提供修复方向。它们保证 loop 安全，不保证 loop 收敛，两者都要，但不要混在一起设计。

## 把 8 种模式还原成一个循环和三个维度

所有 agent loop 都是同一个核心循环：**做 → 判 → 继续、修正、放弃或结束**。常见的 8 种模式（Agentic Tool、Goal、Evaluator Optimizer、Ralph、Planner Executor、Verification Repair、Multi Agent、Event/Time/Proactive），是这个循环在三个维度上的不同取值，外加一个对判官的选择。

| 维度 | 回答的问题 | 对应的常见模式 | 取值由什么决定 |
| --- | --- | --- | --- |
| 判官 | 谁判断对不对、完没完 | Goal、Evaluator Optimizer、Verification Repair | 能拿到的最高判官级别 |
| 状态 | 下一轮怎么知道上一轮做了什么 | Ralph | 任务是否装得进一个 context，以及当前模型在长 context 下是否退化 |
| 拓扑 | 谁决定下一步、几个 agent 一起做 | Tool Loop、Planner Executor、Multi Agent | 任务结构是否会在执行中变化；验证能否拆分 |
| 触发 | 为什么开始这一轮 | Event / Time / Proactive | 被观察的事物多久变一次 |

另外每个 loop 都需要一个**出口规则**：轮数或预算上限、无进展检测、以及“判定不可能并上报”。最后一项最容易被漏掉，而 ImpossibleBench 的结果说明，没有合法的放弃出口，loop 会把压力转化为作弊。`/goal` 的“Impossible”裁决和无工具调用自动停止，就是这条规则的实现。

### 状态：Ralph 的不变量是外部状态，不是 reset

Ralph 解决的问题是“任务比一个 context 长”。Huntley 的原始版本是 `while :; do cat PROMPT.md | claude-code ; done`，每轮新 context，每轮只做一件事，靠测试、类型检查、静态分析做“backpressure”。Anthropic 2025-11 的长程 harness 做法一致：初始化 agent 写出 200 多项全部标为失败的 feature list（JSON，因为模型改 JSON 比改 Markdown 更克制）、进度文件和 git 历史，之后每个会话从零开始读这些文件。

但 reset 是在补一个模型短板：Sonnet 4.5 在 context 快满时会提前收尾（“context anxiety”）。Opus 4.5 上这个行为消失后，Anthropic 的 harness 删掉了 reset，官方 ralph-wiggum 插件干脆在同一会话里循环。所以真正不变的是：**状态写在 context 外面，并且由判官可检查的形式记录**。reset 与否，按你用的模型实测决定。

Ralph 的已知边界也应写清：Huntley 本人说不会在已有代码库上用它，它适合 greenfield；常见失效是重复实现、占位实现和偶发的不可编译状态。

### 拓扑：并行度受限于验证可分解度

C 编译器项目给出的机制比任何 supervisor 图都更有用。16 个 agent 在各自容器里跑，从共享 git 仓库拉代码，写锁文件认领任务，推送后释放锁，没有编排 agent，也没有 agent 间通信。这套结构能工作，是因为有数千个互相独立的失败测试，每个 agent 都能领到一个别人没碰的。

转折点出现在编译 Linux 内核时：16 个 agent 撞上同一个 bug，互相覆盖修改，并行退化为串行。解法不是加一个 supervisor，而是用 GCC 当参照 oracle，大部分文件用 GCC 编译、只让一部分文件走自研编译器，再用 delta debugging 定位，把一个大失败拆成许多小失败。项目后期“新功能和修复经常破坏已有功能”，解法同样是 CI 和更严的门禁，不是更多的协调层。

所以多 agent 的设计顺序应该是：先问验证能不能按互不相干的单元拆开；能拆，共享状态加锁就够了；拆不开，先投资造能拆开它的 oracle，否则多出来的 agent 只是在撞车。Planner Executor 的“replan”同理，值得做的前提是执行中能观察到“计划已失效”的信号，这个信号本身也是一种验证器。

### 触发：频率匹配变化速度，每次运行各自收敛

Time 和 Proactive loop 的特殊之处在于有两层终止：每次运行由自己的目标判定结束，routine 本身一直存在直到被关掉。Claude Code 博客给的组合示例正是这样：`/schedule` 每小时触发一次，`/goal` 要求本轮发现的每个报告都被分诊、处理并回复后才结束。两条实用规则来自同一篇博客：触发间隔匹配被观察事物的变化频率；例行工作用小模型，需要判断的环节用最强模型。

## 组合：每一层都要有自己的判官

长程编码 agent 的成熟形态是多层 loop 嵌套，关键在于每一层在自己的时间尺度上需要独立的终止信号，外层不能拿内层的自报当证据，否则错误逐层复利。

```text
触发层（事件 / 定时）       终止：本次目标达成；routine 由人关闭
└─ 外层（Ralph / 任务队列）  状态：spec、feature list、进度文件、git
   │                        终止：队列清空，或预算耗尽并上报
   └─ 任务层（做 → 判 → 改）  判官：≥3 级检查 + 新 context 审查
      │                     终止：通过 / 判定不可能 / 轮数上限
      └─ 内层（工具循环）     终止：模型给出最终输出；max_turns
```

最常见的组合失误，是外层用“内层说做完了”推进队列。Anthropic 2025-11 的 harness 正是为此规定 agent 只能改 feature list 的 `passes` 字段、不许删改测试项；Carlini 的提醒也在这里：“it is easy to see tests pass and assume the job is done, when this is rarely the case.”

## 设计一个 loop 时的判定顺序

1. **写出完成信号。** 一个可测的终态、一条证明它的命令、一组途中不许变的约束（例如“不许修改其他测试文件”）。这三项来自 `/goal` 文档对有效条件的描述，写不出来就说明还不该循环。
2. **定判官级别。** 能脚本化的检查由 harness 执行，不交给 agent 自报；测试设为只读；脚本覆盖不了的部分，加一个新 context 的审查 agent，并用你自己的判断做几轮校准、读它的日志。
3. **定出口。** 轮数或预算上限、无进展检测、允许 agent 声明“做不到”并上报。
4. **定状态。** 一个 context 装得下就不引入外部状态；装不下，用判官可检查的格式记录进度（JSON 清单、git 提交），reset 与否按当前模型实测。
5. **定拓扑。** 任务结构在执行中会变才上 replanner；验证能拆成独立单元才上并行。
6. **定触发。** 只有前五步在人工触发下稳定之后，才改成定时或事件触发。
7. **模型升级时做消融。** 逐个去掉 harness 组件看结果是否变差，删掉已经变成纯开销的部分。

## 从哪开始

1. 挑一个你已经在让 agent 反复做的任务，按上一节第 1 步写出完成信号，用 `/goal` 或一个 Stop hook 跑起来。触发条件：你发现自己在一轮轮手动输入“继续”或“再检查一下”。
2. 把完成信号里能脚本化的部分改成 Stop hook 脚本或 CI，让判官从 1 级升到 3 级。触发条件：你在记录里看到 agent 声称通过、实际没跑或跑错了命令。
3. 加一个新 context 的审查步骤。触发条件：检查都过了，但你人工看结果仍经常不满意，说明有脚本覆盖不了的质量维度。
4. 任务超出一个会话时，再引入 feature list 和进度文件。触发条件：会话被 compaction 后出现重复劳动或遗漏。
5. 只有当失败可以拆成互不相干的单元时，才开第二个并行 agent。
6. 最后才把它挂到定时或事件上。

## 边界

- 判官分级、“验证可分解度决定并行度”、“自治程度不超过判官级别”是基于下列来源的推断，不是任何一方的实测结论。
- 所有 Anthropic 案例都是厂商对自身系统的描述，没有对照实验；C 编译器和长程应用实验各只有一个项目。
- ImpossibleBench 测的是刻意构造的矛盾任务，作弊率不代表正常任务中的发生率，只说明压力下这种行为会稳定出现。
- 与本文相关的证据治理框架见同项目的 [Post-SDD 参考模型](../post-sdd/Post-SDD参考模型.md)，其中 StrongDM 的 holdout 场景是 4 级判官的一个实例。

## Sources

核对日期均为 2026-10-12。

- [Loop engineering: Getting started with loops](https://claude.com/blog/getting-started-with-loops)，Claude Code 博客，2026-06-30
- [Keep Claude working toward a goal（`/goal` 文档）](https://code.claude.com/docs/en/goal)
- [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)，Anthropic，2026-03-24
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)，Anthropic，2025-11-26
- [Managed Agents](https://www.anthropic.com/engineering/managed-agents)，Anthropic，2026-04-08
- [Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler)，Nicholas Carlini，2026-02-05
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)，Anthropic，2024-12-19（evaluator-optimizer 等模式名称的出处）
- [Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)，Geoffrey Huntley，2025-07-14
- [ralph-wiggum 插件 README](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum)，anthropics/claude-code
- [Running agents](https://openai.github.io/openai-agents-python/running_agents/)，OpenAI Agents SDK 文档
- [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798)，Huang 等，2023
- [ImpossibleBench: Measuring LLMs' Propensity of Exploiting Test Cases](https://arxiv.org/abs/2510.20270)，Zhong、Raghunathan、Carlini，2025-10-23

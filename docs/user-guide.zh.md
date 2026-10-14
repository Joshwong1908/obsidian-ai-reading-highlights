# AI Reading Highlights 使用指南

AI Reading Highlights 用你配置的大模型给笔记做语义高亮:重点句、关键词、概念在渲染层直接标出,笔记文件本身一个字节都不改。

## 它标什么

| 高亮 | 含义 | 样式 |
|---|---|---|
| 重点句 | 承载这段论点的那句话 | 暖色整句浅染,像荧光笔划过 |
| 关键词 | 值得记住的领域词 | 靛蓝实线下划线 |
| 概念 | 具名的模型、方法、定律 | 青色点状下划线(药丸样式下为浅色底) |

鼠标悬停任意高亮会显示角色名。三种高亮可以在设置里分别开关。

## 安装

社区插件市场搜索 AI Reading Highlights 安装,或手动把 `main.js`、`manifest.json`、`styles.css` 放进 `<vault>/.obsidian/plugins/ai-reading-highlights/` 后在设置里启用。

## 配置模型

设置 → AI Reading Highlights → Classification API,填三项:Base URL、API key、Model,点 Test connection 验证。填好后打开任意笔记,几秒内出现高亮。

常用端点示例:

| 服务商 | Base URL | 备注 |
|---|---|---|
| 智谱 GLM Coding Plan | `https://open.bigmodel.cn/api/coding/paas/v4` | 注意是 coding 专用端点,普通 `/api/paas/v4` 会报余额不足;保持"Disable model thinking"开启,速度从分钟级降到十秒级 |
| OpenAI | `https://api.openai.com/v1` | 模型如 `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | 模型如 `deepseek-chat` |
| 本地 Ollama | `http://127.0.0.1:11434/v1` | key 随意填非空 |

不配置 API 也能用:离线启发式会把 `**加粗**` 标为重点句、引号短语标为关键词,零等待。

## 两条命令

- `Reclassify current note now`:强制重新分类当前笔记(换模型或想刷新结果时用)。
- `Diagnose rendering`:输出渲染诊断到 Notice 和 `diagnosis.txt`,排障第一步。

## 隐私

分类时会把当前笔记的文本块发送到你配置的端点,除此之外不发送任何东西。结果只存在插件自己的 `cache.json`,笔记文件永远不改。

## 看不到高亮时按顺序查

1. 是否完全重启过 Obsidian(托盘退出再开,不是最小化)。
2. 笔记是否打开超过三秒(API 模式需要几秒)。
3. 跑一次 `Diagnose rendering`,看 Notice 里 `cmMarks` 是否大于 0。大于 0 说明标记在渲染,是主题或样式问题;等于 0 再看 `liveHits`,它为 0 说明该笔记还没有分类记录,跑一次 Reclassify。
4. 旧版渲染引擎(约 2023 年前的 Obsidian)会自动退回纯色高亮,若完全无色请先升级 Obsidian。

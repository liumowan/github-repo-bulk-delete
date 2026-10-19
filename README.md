# GitHub 仓库批量删除（油猴脚本）

一个**零外部依赖**的油猴脚本，用来按条件筛选并批量删除你自己的 GitHub 仓库（比如清理大量 fork）。

- 右下角悬浮「批量删」按钮，点开即用，**不依赖 GitHub 页面结构**——不会因为 GitHub 界面改版而失效
- **仓库详情页可一键删除当前仓库**：点进任意仓库，面板顶部直接显示「删除当前仓库」
- 完全自绘 UI，不加载 jQuery / layer 等任何 CDN 资源——不会因为 CDN 被墙而启动失败
- 直接在 GitHub 页面间切换（软导航）时自动重新注入面板，不会消失
- 直接调用 [GitHub REST API](https://docs.github.com/zh/rest)，删除前有二次确认

作者：[liumowan](https://github.com/liumowan)

## 安装

### 1. 装油猴管理器

Chrome / Edge 装 [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)（或 [Violentmonkey](https://violentmonkey.github.io/get-it/)），Firefox 同理。

### 2. 安装脚本

打开本仓库的 `github-repo-bulk-delete.user.js`，Tampermonkey 会弹出安装页，点「安装」即可。

> 也可以在 Tampermonkey 管理面板 → 新建脚本 → 把 `github-repo-bulk-delete.user.js` 全文粘贴进去保存。

## 使用

### 1. 申请 Token

1. 打开 <https://github.com/settings/tokens/new>
2. 创建 **classic token**，勾选 `delete_repo`（至少）或 `repo`；
   或创建 **fine-grained token**，仓库权限勾选 `Administration: Read and write`
3. 生成后复制 `ghp_` 开头的 token

### 2. 在 GitHub 页面操作

1. 打开任意 `github.com` 页面（登录状态），右下角出现绿色「**批量删**」按钮
2. 点开面板，把 token 粘贴到输入框 → 点「保存」（token 只存在你本机的油猴存储里）
3. 点「**加载仓库**」→ 列表出现你的全部仓库
4. 用筛选条件缩小范围：关键词、语言、只看 fork、隐藏归档，点「筛选」
5. 勾选要删的仓库（可点行、可「全选」）
6. 点「**删除选中**」→ 核对清单 → 点「**确认删除**」
7. 结果会显示成功/失败个数；失败多为 403 限流或权限问题，重新生成 token 再试

### 3. 在仓库详情页一键删除当前仓库

点进任意仓库页面（`github.com/owner/repo`）时，点开「批量删」面板，顶部会出现：

```
当前仓库：owner/repo    [删除当前仓库]
```

核对仓库名后点「删除当前仓库」→ 确认 → 即删除。不用先加载仓库列表，适合单独清理某个仓库。

> ⚠️ **删除不可恢复**。勾选后先核对确认框里的仓库名再点确认。

## 安全说明

- Token 只保存在你本机浏览器（Tampermonkey 的 GM 存储），不会上传到任何第三方
- 建议用完删除 token，或生成后只保留 `delete_repo` 权限
- 删除操作串行批量执行（2 并发，每次间隔 400ms），避免触发 GitHub API 限流

## 和旧油猴脚本的区别

老脚本（如 Greasy Fork 412188，2020 年）依赖页面里的 `#user-repositories-list`、`ul.UnderlineNav-body` 等 DOM 元素，GitHub 2023 年改版后这些结构没了，脚本就失效了。本脚本不碰页面结构，只往页面里注入一个浮动面板，通过官方 API 工作，因此长期可用。

## License

[MIT](./LICENSE) © 2025 [liumowan](https://github.com/liumowan)

# GitHub 仓库批量删除工具

一个**零依赖**的 Node.js 命令行工具，用来列出、筛选并批量删除你自己的 GitHub 仓库（比如清理大量 fork）。

它直接调用 [GitHub REST API](https://docs.github.com/zh/rest)，**不依赖网页 DOM**，所以 GitHub 界面怎么改版都不影响使用——这也是它比老式油猴脚本（如 Greasy Fork 412188）稳的原因。

作者：[liumowan](https://github.com/liumowan)

## 功能

- ✅ 一键列出当前账号的全部仓库（自动分页，含 fork）
- ✅ 按条件筛选：fork / 非 fork、已归档 / 未归档、主语言、名称/描述关键词
- ✅ 批量删除：传仓库名、按筛选条件、或 `--all` 全部删除
- ✅ 删除前二次确认；`--dry-run` 干跑预览，不真正删除
- ✅ Token 从 `.env` / 环境变量读取，绝不硬编码、绝不提交进 git

## 环境要求

- Node.js **18+**（用内置 `fetch`，无需 `npm install` 任何依赖）

## 快速开始

### 1. 申请 Token

1. 打开 <https://github.com/settings/tokens/new>
2. 创建 **classic token**，勾选权限 `repo`（或至少 `delete_repo`）；
   或者创建 **fine-grained token**，仓库权限里勾选 `Administration: Read and write`
3. 生成后复制那串 `ghp_` 开头的 token

### 2. 配置 Token

```bash
# 项目根目录下
cp .env.example .env
# 编辑 .env，把 GITHUB_TOKEN 换成你自己的
```

> ⚠️ `.env` 已被 `.gitignore` 排除，**永远不要把它提交到 GitHub**。

### 3. 查看你的仓库

```bash
node ghdel.js list
node ghdel.js list --forks            # 只看 fork
node ghdel.js list --language javascript
node ghdel.js list --forks --language python --json
```

### 4. 删除仓库（先干跑，再真删）

```bash
# 先预览：按条件筛选出要删的清单
node ghdel.js delete --forks --dry-run

# 确认无误后真正删除（会二次确认）
node ghdel.js delete --forks --language python

# 也可以直接指定仓库
node ghdel.js delete liumowan/old-repo
node ghdel.js delete liumowan/a liumowan/b liumowan/c

# 全部仓库（谨慎！）
node ghdel.js delete --all --dry-run
node ghdel.js delete --all --yes
```

## 命令参考

```
node ghdel.js list   [筛选参数] [--json]
node ghdel.js delete <owner/repo ...> [--yes] [--dry-run]
node ghdel.js delete [筛选参数] [--all] [--yes] [--dry-run]
node ghdel.js help
```

### 筛选参数（可组合，组合条件为 AND）

| 参数 | 说明 |
| --- | --- |
| `--forks` | 只看 fork 仓库 |
| `--no-forks` | 只看自己创建的仓库 |
| `--archived` | 只看已归档仓库 |
| `--no-archived` | 只看未归档仓库 |
| `--language <语言>` | 按主语言筛选，如 `javascript` / `python` / `go` |
| `--search <关键词>` | 按仓库名 / 描述关键词筛选 |

### 其他参数

| 参数 | 说明 |
| --- | --- |
| `--token <token>` | 临时指定 token（更推荐写入 `.env`） |
| `--json` | 以 JSON 输出（仅 `list`） |
| `--dry-run` | 只预览将删除的清单，不真正删除 |
| `--yes` | 跳过确认提示（自动化脚本用，谨慎） |
| `--all` | 选中全部仓库（无筛选时 = 删除所有仓库，慎用） |

## 安全提示

- **删除不可恢复**。动手前先用 `--dry-run` 确认清单。
- Token 权限遵循最小化原则：平时只给 `repo` 读权限或干脆用完即删，需要删除时再生成带 `delete_repo` 的 token。
- `.env` 里是你的真实 token，已加入 `.gitignore`；更换电脑 / 怀疑泄露时，去 GitHub 设置里**撤销**旧 token。
- 若反复出现删除失败（403），多为 GitHub API 限流或 token 权限不足，重新生成一个 token 换掉即可。

## 技术说明

- 数据源：`GET /user/repos`（当前登录账号，自动分页拉全）
- 删除：`DELETE /repos/{owner}/{repo}`（HTTP 204 为成功）
- 单文件实现，无任何第三方依赖，可直接阅读源码。

## License

[MIT](./LICENSE) © 2025 [liumowan](https://github.com/liumowan)

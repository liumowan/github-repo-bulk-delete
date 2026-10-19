#!/usr/bin/env node
/**
 * GitHub 仓库批量删除工具（零依赖）
 * 直接调用 GitHub REST API，不依赖网页 DOM，GitHub 界面改版不影响使用。
 *
 * 作者：liumowan  (https://github.com/liumowan)
 * 仓库：https://github.com/liumowan/github-repo-bulk-delete
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'node:readline/promises';

const API = 'https://api.github.com';
const VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { cmd: null, flags: {}, repos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (args.cmd === null) {
      args.cmd = a;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > -1 ? a.slice(2, eq) : a.slice(2);
      if (eq > -1) {
        args.flags[key] = a.slice(eq + 1);
      } else if (
        ['token', 'language', 'search'].includes(key) &&
        i + 1 < argv.length &&
        !argv[i + 1].startsWith('--')
      ) {
        args.flags[key] = argv[++i];
      } else {
        args.flags[key] = true;
      }
    } else {
      args.repos.push(a);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Token 读取：--token > 环境变量 GITHUB_TOKEN > .env 文件
// ---------------------------------------------------------------------------
function loadToken(explicit) {
  if (explicit) return explicit;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const envPath = resolve('.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*GITHUB_TOKEN\s*=\s*(.*?)\s*$/);
      if (m) {
        let v = m[1].trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (v) return v;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------
async function api(path, token, method = 'GET', body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, link: res.headers.get('link'), data };
}

/** 分页拉取当前账号的全部仓库（含 fork） */
async function fetchAllRepos(token) {
  const repos = [];
  let page = 1;
  for (;;) {
    const { status, link, data } = await api(
      `/user/repos?per_page=100&page=${page}`,
      token
    );
    if (status === 401) {
      throw new Error('Token 无效或已过期（HTTP 401）。请重新生成后填入 .env。');
    }
    if (status === 403) {
      throw new Error(
        '权限不足（HTTP 403）：Token 需要 repo / delete_repo 权限，或已触发 API 限流。'
      );
    }
    if (status !== 200) {
      throw new Error(`拉取仓库失败（HTTP ${status}）：${JSON.stringify(data)}`);
    }
    repos.push(...data);
    if (!/rel="next"/.test(link || '')) break;
    page++;
  }
  return repos;
}

// ---------------------------------------------------------------------------
// 筛选（组合条件 = AND）
// ---------------------------------------------------------------------------
function filterRepos(repos, flags) {
  const has = (k) => flags[k] !== undefined;
  return repos.filter((r) => {
    if (has('forks') && !r.fork) return false;
    if (has('no-forks') && r.fork) return false;
    if (has('archived') && !r.archived) return false;
    if (has('no-archived') && r.archived) return false;
    if (has('language')) {
      const lang = String(flags.language).toLowerCase();
      if (!(r.language || '').toLowerCase().includes(lang)) return false;
    }
    if (has('search')) {
      const kw = String(flags.search).toLowerCase();
      const hay = `${r.name} ${r.description || ''} ${r.language || ''}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function shortRepo(r) {
  return {
    full_name: r.full_name,
    fork: r.fork,
    archived: r.archived,
    language: r.language,
    description: r.description,
    html_url: r.html_url,
    stargazers_count: r.stargazers_count,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// list 命令
// ---------------------------------------------------------------------------
async function cmdList(token, flags) {
  const all = await fetchAllRepos(token);
  const list = filterRepos(all, flags);

  if (flags.json) {
    console.log(JSON.stringify(list.map(shortRepo), null, 2));
    return;
  }

  console.log(`账号共 ${all.length} 个仓库，筛选后 ${list.length} 个：`);
  for (const r of list) {
    const tags = [
      r.fork ? 'fork' : '',
      r.archived ? 'archived' : '',
    ]
      .filter(Boolean)
      .join(',');
    const tag = tags ? ` [${tags}]` : '';
    console.log(
      `  ${r.full_name}${tag}  ${r.language || ''}  ★${r.stargazers_count}`
    );
  }
}

// ---------------------------------------------------------------------------
// delete 命令
// ---------------------------------------------------------------------------
function normalizeRepo(input) {
  let s = input.trim();
  s = s.replace(/^https?:\/\/github\.com\//i, '');
  s = s.replace(/\.git$/, '');
  s = s.replace(/\/+$/, '');
  if (!s.includes('/')) {
    throw new Error(`仓库名格式应为 owner/repo，收到："${input}"`);
  }
  return s;
}

async function cmdDelete(token, flags, repos) {
  let targets = [];

  if (repos.length) {
    targets = repos.map(normalizeRepo);
  } else {
    const all = await fetchAllRepos(token);
    const hasFilter = [
      'forks',
      'no-forks',
      'archived',
      'no-archived',
      'language',
      'search',
    ].some((k) => flags[k] !== undefined);

    if (!hasFilter && !flags.all) {
      console.error(
        '错误：delete 必须指定仓库名，或用筛选条件选仓库。\n' +
          '  示例：\n' +
          '    node ghdel.js delete liumowan/repo1 liumowan/repo2\n' +
          '    node ghdel.js delete --forks --language javascript\n' +
          '    node ghdel.js delete --all\n' +
          '  查看帮助：node ghdel.js help'
      );
      return 1;
    }

    targets = (flags.all && !hasFilter)
      ? all.map((r) => r.full_name)
      : filterRepos(all, flags).map((r) => r.full_name);
  }

  if (!targets.length) {
    console.log('没有匹配的仓库，未做任何操作。');
    return;
  }

  // 去重
  targets = [...new Set(targets)];

  if (flags['dry-run']) {
    console.log(
      `[dry-run] 将删除 ${targets.length} 个仓库（仅预览，不会真正删除）：`
    );
    for (const t of targets) console.log('  - ' + t);
    return;
  }

  console.log(`即将删除 ${targets.length} 个仓库，此操作不可恢复！`);
  for (const t of targets) console.log('  - ' + t);

  if (!flags.yes) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question(
      `输入 yes 确认删除全部 ${targets.length} 个仓库，输入其他内容取消：`
    );
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('已取消，未删除任何仓库。');
      return;
    }
  }

  let ok = 0;
  const failed = [];
  for (const t of targets) {
    const { status, data } = await api(`/repos/${t}`, token, 'DELETE');
    if (status === 204) {
      ok++;
      console.log(`✔ 已删除 ${t}`);
    } else if (status === 404) {
      failed.push([t, '仓库不存在，或该仓库不属于当前账号']);
      console.log(`✘ ${t}: 404 仓库不存在`);
    } else if (status === 403) {
      failed.push([t, `403 ${data?.message || '权限不足/限流'}`]);
      console.log(`✘ ${t}: 403 ${data?.message || ''}`);
    } else {
      failed.push([t, `HTTP ${status} ${data?.message || ''}`]);
      console.log(`✘ ${t}: HTTP ${status} ${data?.message || ''}`);
    }
  }

  console.log(`\n完成：成功删除 ${ok} 个，失败 ${failed.length} 个。`);
  if (failed.length) {
    console.log('失败的仓库：');
    for (const [t, reason] of failed) console.log(`  - ${t}: ${reason}`);
    console.log(
      '提示：若反复 403，多为 API 限流或 token 权限不足，可重新生成 token 再试。'
    );
  }
}

// ---------------------------------------------------------------------------
// 帮助 & 入口
// ---------------------------------------------------------------------------
const HELP = `
GitHub 仓库批量删除工具 v${VERSION}（作者：liumowan）
零依赖 Node.js CLI，直接调用 GitHub API，与网页改版无关。

用法：
  node ghdel.js list   [筛选参数] [--json]
  node ghdel.js delete <owner/repo ...> [--yes] [--dry-run]
  node ghdel.js delete [筛选参数] [--all] [--yes] [--dry-run]
  node ghdel.js help

筛选参数（可组合，组合条件为 AND）：
  --forks               只看 fork 仓库
  --no-forks            只看自己创建的仓库
  --archived            只看已归档仓库
  --no-archived         只看未归档仓库
  --language <语言>     按主语言筛选（如 javascript / python / go）
  --search <关键词>     按仓库名/描述关键词筛选

其他参数：
  --token <token>       临时指定 token（更推荐写入 .env）
  --json                以 JSON 输出结果（list）
  --dry-run             只预览将删除的清单，不真正删除
  --yes                 跳过确认提示（自动化脚本用，谨慎）
  --all                 选中全部仓库（无筛选时 = 删除所有仓库，慎用）

示例：
  node ghdel.js list --forks
  node ghdel.js list --language javascript --json
  node ghdel.js delete --forks --dry-run
  node ghdel.js delete liumowan/old-repo --dry-run
  node ghdel.js delete liumowan/old-repo
  node ghdel.js delete --forks --language python --yes

Token 配置：
  复制 .env.example 为 .env，填入你的 GITHUB_TOKEN。
  申请地址：https://github.com/settings/tokens/new
  权限：classic token 勾选 repo（或至少 delete_repo）；
        fine-grained token 勾选 Administration: Read and write。
`;

async function main() {
  const { cmd, flags, repos } = parseArgs(process.argv.slice(2));

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    console.log(HELP);
    return;
  }
  if (cmd !== 'list' && cmd !== 'delete') {
    console.error(`未知命令：${cmd}\n`);
    console.log(HELP);
    return 1;
  }

  const token = loadToken(flags.token);
  if (!token) {
    console.error(
      '未配置 GITHUB_TOKEN。\n' +
        '  方法1：复制 .env.example 为 .env，填入你的 token\n' +
        '  方法2：设置环境变量 GITHUB_TOKEN\n' +
        '  方法3：--token <token>（注意会留在终端历史里）\n' +
        '  申请地址：https://github.com/settings/tokens/new'
    );
    process.exit(1);
  }

  try {
    if (cmd === 'list') {
      await cmdList(token, flags);
      return 0;
    }
    return (await cmdDelete(token, flags, repos)) || 0;
  } catch (e) {
    console.error('出错：' + e.message);
    return 1;
  }
}

process.exitCode = await main();

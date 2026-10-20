// ==UserScript==
// @name         GitHub 仓库批量删除
// @namespace    https://github.com/liumowan
// @version      1.5.0
// @description  右下角悬浮面板，按条件筛选、批量删除 GitHub 仓库。API 驱动、零外部依赖，GitHub 界面改版也不失效。
// @author       liumowan
// @license      MIT
// @match        *://github.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @connect      api.github.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const API = 'https://api.github.com';
  const TOKEN_KEY = 'gh_bulk_delete_token';

  // ====== 把你的 GitHub Token 填在下面这行（只填在篡改猴里安装的脚本副本，千万别提交到 GitHub 仓库）======
  // 例如：const CONFIG_TOKEN = 'ghp_xxxxxxxxxxxxxxxxxxxx';
  const CONFIG_TOKEN = '';

  let token = CONFIG_TOKEN || GM_getValue(TOKEN_KEY, '');
  let allRepos = [];
  let filtered = [];
  let selected = new Set();
  let deleting = false;
  let panelOpen = false;

  // ---------------- 工具 ----------------
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 当前是否在某个仓库详情页，返回 owner/repo，否则返回 ''
  const currentRepo = () => {
    const m = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]');
    return m ? m.content : '';
  };

  function req(method, url, headers, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: method,
        url: url,
        headers: headers,
        data: body ? JSON.stringify(body) : undefined,
        timeout: 30000,
        onload: resolve,
        onerror: (e) => reject(new Error('网络错误 ' + (e.error || ''))),
        ontimeout: () => reject(new Error('请求超时')),
      });
    });
  }

  async function api(path, method, body) {
    method = method || 'GET';
    const headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await req(method, API + path, headers, body);
    let data = null;
    if (res.responseText) {
      try {
        data = JSON.parse(res.responseText);
      } catch (_) {
        data = null;
      }
    }
    return { status: res.status, headers: res.responseHeaders, data: data };
  }

  async function fetchAllRepos() {
    const repos = [];
    let page = 1;
    for (;;) {
      const { status, headers, data } = await api('/user/repos?per_page=100&page=' + page);
      if (status === 401) throw new Error('Token 无效或已过期（401），请重新生成。');
      if (status === 403) throw new Error('权限不足或触发限流（403）：token 需有 repo / delete_repo 权限。');
      if (status !== 200) throw new Error('拉取仓库失败（HTTP ' + status + '）');
      repos.push.apply(repos, data);
      if (!/rel="next"/i.test(headers || '')) break;
      page++;
    }
    return repos;
  }

  // ---------------- 筛选 & 渲染 ----------------
  function applyFilter() {
    const kw = document.getElementById('bd-search').value.trim().toLowerCase();
    const lang = document.getElementById('bd-lang').value.trim().toLowerCase();
    const onlyFork = document.getElementById('bd-fork').checked;
    const hideArch = document.getElementById('bd-hide-arch').checked;
    filtered = allRepos.filter((r) => {
      if (onlyFork && !r.fork) return false;
      if (hideArch && r.archived) return false;
      if (lang && !(r.language || '').toLowerCase().includes(lang)) return false;
      if (kw) {
        const hay = (r.name + ' ' + (r.description || '') + ' ' + (r.language || '')).toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    renderList();
  }

  function renderList() {
    const list = document.getElementById('bd-list');
    list.innerHTML = '';
    filtered.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'bd-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = r.full_name;
      cb.checked = selected.has(r.full_name);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(r.full_name);
        else selected.delete(r.full_name);
        updateSel();
      });

      const name = document.createElement('span');
      name.className = 'bd-item-name';
      name.textContent = r.full_name;

      const meta = document.createElement('span');
      meta.className = 'bd-item-meta';
      meta.textContent =
        (r.fork ? 'fork ' : '') +
        (r.archived ? '归档 ' : '') +
        (r.language || '') +
        ' ★' + r.stargazers_count;

      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(meta);
      row.addEventListener('click', (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
      list.appendChild(row);
    });
    document.getElementById('bd-count').textContent =
      '共 ' + allRepos.length + ' 个，筛选后 ' + filtered.length + ' 个';
    updateSel();
  }

  function updateSel() {
    document.getElementById('bd-sel').textContent = '已选 ' + selected.size;
  }

  function setMsg(text, isErr) {
    const el = document.getElementById('bd-msg');
    el.textContent = text;
    el.classList.toggle('err', !!isErr);
  }

  // ---------------- 数据操作 ----------------
  async function loadRepos() {
    if (!token) {
      setMsg('未设置 Token：请在篡改猴里编辑本脚本，把顶部 CONFIG_TOKEN 改成你的 token 后保存。', true);
      return;
    }
    setMsg('正在加载仓库列表…', false);
    allRepos = await fetchAllRepos();
    selected.clear();
    applyFilter();
    setMsg('已加载 ' + allRepos.length + ' 个仓库', false);
  }

  // ---------------- 删除 ----------------
  function confirmDelete() {
    const names = Array.from(selected);
    const box = document.getElementById('bd-confirm');
    if (!names.length) {
      setMsg('请先勾选要删除的仓库', true);
      return;
    }
    box.hidden = false;
    box.innerHTML =
      '<div>将删除 <b>' + names.length + '</b> 个仓库，<b>不可恢复</b>：</div>' +
      '<div class="bd-preview">' +
      names.slice(0, 10).map(esc).join('、') +
      (names.length > 10 ? ' 等' : '') +
      '</div>' +
      '<div class="bd-row">' +
      '<button id="bd-ok" type="button" class="bd-danger">确认删除</button>' +
      '<button id="bd-cancel" type="button">取消</button>' +
      '</div>';
    document.getElementById('bd-cancel').addEventListener('click', () => {
      box.hidden = true;
    });
    document.getElementById('bd-ok').addEventListener('click', () => {
      box.hidden = true;
      doDelete(names);
    });
  }

  async function doDelete(names) {
    if (deleting) return;
    deleting = true;
    setMsg('正在删除…', false);
    const okList = [];
    const failList = [];
    let idx = 0;

    async function worker() {
      while (idx < names.length) {
        const name = names[idx++];
        try {
          const { status, data } = await api('/repos/' + name, 'DELETE');
          if (status === 204) {
            okList.push(name);
          } else {
            failList.push(
              name + '：' + (status === 404 ? '不存在或无权限' : (data && data.message) || 'HTTP ' + status)
            );
          }
        } catch (e) {
          failList.push(name + '：' + e.message);
        }
        await sleep(400);
      }
    }

    // 2 并发，避免 GitHub 限流
    await Promise.all([worker(), worker()]);
    deleting = false;
    selected = new Set();

    let msg = '删除完成：成功 ' + okList.length + ' 个，失败 ' + failList.length + ' 个。';
    if (failList.length) msg += ' 失败：' + failList.slice(0, 5).join('；');
    setMsg(msg, failList.length > 0 && okList.length === 0);

    // 有成功删除的，立即跳回仓库列表页；全部失败则留在这里显示原因
    const owner = names.length ? names[0].split('/')[0] : '';
    if (owner && okList.length > 0) {
      location.href = 'https://github.com/' + owner + '?tab=repositories';
    }
  }

  // ---------------- 一键删除当前仓库 ----------------
  function confirmDeleteCurrent() {
    const nwo = currentRepo();
    if (!nwo) {
      setMsg('当前页面不是仓库页，无法快速删除当前仓库', true);
      return;
    }
    if (!token) {
      setMsg('未设置 Token：请在篡改猴里编辑本脚本，把顶部 CONFIG_TOKEN 改成你的 token 后保存。', true);
      return;
    }
    const box = document.getElementById('bd-confirm');
    box.hidden = false;
    box.innerHTML =
      '<div>将删除当前仓库：<b class="bd-preview">' + esc(nwo) + '</b>，<b>不可恢复</b>：</div>' +
      '<div class="bd-row">' +
      '<button id="bd-ok" type="button" class="bd-danger">确认删除</button>' +
      '<button id="bd-cancel" type="button">取消</button>' +
      '</div>';
    document.getElementById('bd-cancel').addEventListener('click', () => {
      box.hidden = true;
    });
    document.getElementById('bd-ok').addEventListener('click', () => {
      box.hidden = true;
      doDeleteOne(nwo);
    });
  }

  async function doDeleteOne(nwo) {
    if (deleting) return;
    deleting = true;
    setMsg('正在删除 ' + nwo + ' …', false);
    try {
      const { status, data } = await api('/repos/' + nwo, 'DELETE');
      if (status === 204) {
        setMsg('已删除 ' + nwo + '，正在跳转…', false);
        allRepos = allRepos.filter((r) => r.full_name !== nwo);
        selected.delete(nwo);
        applyFilter();
        location.href = 'https://github.com/' + nwo.split('/')[0] + '?tab=repositories';
      } else if (status === 404) {
        setMsg('删除失败：仓库不存在或无权访问（404）', true);
      } else {
        setMsg('删除失败：' + ((data && data.message) || 'HTTP ' + status), true);
      }
    } catch (e) {
      setMsg('删除失败：' + e.message, true);
    } finally {
      deleting = false;
    }
  }

  // ---------------- UI ----------------
  const CSS = [
    '#bd-root{position:fixed;right:0;bottom:0;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#1f2328;text-align:left}',
    '#bd-root *{box-sizing:border-box;font-family:inherit}',
    '#bd-toggle{position:fixed;right:18px;bottom:18px;width:46px;height:46px;border-radius:50%;background:#2da44e;color:#fff;border:0;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3);padding:0}',
    '#bd-toggle:hover{background:#2c974b}',
    '#bd-toggle svg{width:22px;height:22px;display:block}',
    '#bd-panel{position:fixed;right:16px;bottom:60px;width:420px;max-width:calc(100vw - 32px);max-height:75vh;display:none;flex-direction:column;background:#fff;border:1px solid #d1d9e0;border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,.25);overflow:hidden}',
    '#bd-panel.open{display:flex}',
    '.bd-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eaeef2;font-weight:600;background:#f6f8fa}',
    '#bd-close{border:0;background:transparent;font-size:15px;color:#57606a;cursor:pointer;padding:0 4px}',
    '.bd-body{padding:10px 12px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:8px}',
    '.bd-row{display:flex;gap:6px;align-items:center}',
    '.bd-row input[type=text],.bd-row input[type=password]{flex:1;min-width:0;padding:5px 8px;border:1px solid #d1d9e0;border-radius:6px;font-size:13px;background:#fff;color:#1f2328}',
    '.bd-row button{border:1px solid #d1d9e0;background:#f6f8fa;border-radius:6px;padding:5px 10px;font-size:13px;cursor:pointer;white-space:nowrap;color:#1f2328}',
    '.bd-row button:hover{background:#eaeef2}',
    '.bd-danger{background:#cf222e !important;border-color:#cf222e !important;color:#fff !important}',
    '.bd-danger:hover{background:#a40e26 !important}',
    '.bd-check{display:flex;align-items:center;gap:4px;font-size:13px;color:#57606a}',
    '.bd-list{border:1px solid #eaeef2;border-radius:6px;max-height:260px;overflow-y:auto}',
    '.bd-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid #f6f8fa;cursor:pointer}',
    '.bd-item:last-child{border-bottom:0}',
    '.bd-item:hover{background:#f6f8fa}',
    '.bd-item input{margin:0;cursor:pointer}',
    '.bd-item-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bd-item-meta{color:#8c959f;font-size:11px;white-space:nowrap}',
    '.bd-current{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #ffebe9;background:#fff5f5;border-radius:6px}',
    '.bd-current-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#57606a}',
    '#bd-del-cur{border:1px solid #cf222e;background:#cf222e;color:#fff;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;white-space:nowrap}',
    '#bd-del-cur:hover{background:#a40e26}',
    '.bd-foot{display:flex;align-items:center;gap:6px;padding:8px 12px;border-top:1px solid #eaeef2;background:#f6f8fa}',
    '.bd-foot button{border:1px solid #d1d9e0;background:#fff;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;color:#1f2328}',
    '.bd-foot button:hover{background:#f6f8fa}',
    '.bd-muted{color:#8c959f;font-size:12px;margin-left:auto}',
    '.bd-confirm{padding:10px 12px;border-top:1px solid #eaeef2;background:#fff5f5}',
    '.bd-preview{font-family:ui-monospace,monospace;font-size:12px;color:#57606a;margin:4px 0;word-break:break-all}',
    '.bd-msg{padding:8px 12px;font-size:12px;color:#1a7f37;border-top:1px solid #eaeef2;background:#fff}',
    '.bd-msg.err{color:#cf222e}',
  ].join('\n');

  function buildUI() {
    const oldStyle = document.getElementById('bd-style');
    if (oldStyle) oldStyle.remove();
    const style = document.createElement('style');
    style.id = 'bd-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'bd-root';
    root.innerHTML =
      '<button id="bd-toggle" type="button" title="批量删除仓库" aria-label="批量删除仓库">' +
      '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5 0V3h2.25a.75.75 0 0 1 0 1.5H13v9.25A2.25 2.25 0 0 1 10.75 16h-5.5A2.25 2.25 0 0 1 3 13.75V4.5H2.25a.75.75 0 0 1 0-1.5H4.5V1.75A1.25 1.25 0 0 1 5.75.5h4.5A1.25 1.25 0 0 1 11.5 1.75ZM4.5 4.5v9.25c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75V4.5h-7Zm2.5 2a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 7 6.5Zm3.75.75a.75.75 0 0 1 1.5 0v4.5a.75.75 0 0 1-1.5 0v-4.5Z"/></svg>' +
      '</button>' +
      '<div id="bd-panel">' +
      '<div class="bd-head">GitHub 仓库批量删除<button id="bd-close" type="button">✕</button></div>' +
      '<div class="bd-body">' +
      '<div id="bd-current" class="bd-current" hidden><span class="bd-current-name"></span><button id="bd-del-cur" type="button" class="bd-danger">删除当前仓库</button></div>' +
      '<div class="bd-row"><button id="bd-load" type="button">加载仓库</button><span id="bd-count" class="bd-muted"></span></div>' +
      '<div class="bd-row"><input id="bd-search" type="text" placeholder="名称 / 描述关键词"><input id="bd-lang" type="text" placeholder="语言如 javascript"></div>' +
      '<div class="bd-row"><label class="bd-check"><input id="bd-fork" type="checkbox"> 只看 fork</label><label class="bd-check"><input id="bd-hide-arch" type="checkbox"> 隐藏归档</label><button id="bd-filter" type="button">筛选</button></div>' +
      '<div id="bd-list" class="bd-list"></div>' +
      '</div>' +
      '<div class="bd-foot">' +
      '<button id="bd-all" type="button">全选</button>' +
      '<button id="bd-none" type="button">取消全选</button>' +
      '<span id="bd-sel" class="bd-muted">已选 0</span>' +
      '<button id="bd-del" type="button" class="bd-danger">删除选中</button>' +
      '</div>' +
      '<div id="bd-confirm" class="bd-confirm" hidden></div>' +
      '<div id="bd-msg" class="bd-msg"></div>' +
      '</div>';
    document.body.appendChild(root);

    const nwo = currentRepo();
    if (nwo) {
      const bar = document.getElementById('bd-current');
      bar.hidden = false;
      document.querySelector('#bd-current .bd-current-name').textContent = nwo;
    }
  }

  function init() {
    if (document.getElementById('bd-toggle')) return;
    buildUI();
    const $id = (id) => document.getElementById(id);

    $id('bd-toggle').addEventListener('click', () => {
      $id('bd-panel').classList.toggle('open');
      panelOpen = $id('bd-panel').classList.contains('open');
    });
    $id('bd-close').addEventListener('click', () => {
      $id('bd-panel').classList.remove('open');
      panelOpen = false;
    });
    $id('bd-load').addEventListener('click', () => {
      loadRepos().catch((e) => setMsg(e.message, true));
    });
    $id('bd-filter').addEventListener('click', applyFilter);
    $id('bd-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilter();
    });
    $id('bd-lang').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilter();
    });
    $id('bd-all').addEventListener('click', () => {
      filtered.forEach((r) => selected.add(r.full_name));
      renderList();
    });
    $id('bd-none').addEventListener('click', () => {
      selected.clear();
      renderList();
    });
    $id('bd-del').addEventListener('click', confirmDelete);
    $id('bd-del-cur').addEventListener('click', confirmDeleteCurrent);

    if (panelOpen) $id('bd-panel').classList.add('open');
    if (allRepos.length) renderList();
  }

  // ---------------- 页面导航（GitHub Turbo 软导航）后重新注入 ----------------
  function onNavigate() {
    const old = document.getElementById('bd-root');
    if (old) old.remove();
    init();
  }

  function watchNavigation() {
    ['turbo:load', 'turbo:render', 'pjax:end'].forEach((ev) => {
      document.addEventListener(ev, () => setTimeout(onNavigate, 60));
    });
    let timer = null;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.body && !document.getElementById('bd-root')) {
          init();
        }
      }, 400);
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: false });
  }

  function boot() {
    init();
    watchNavigation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

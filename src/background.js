/**
 * background.js —— MV3 service worker
 *
 * 只做三件事：
 *   1. 右键菜单 / 快捷键 → 让 popup 弹出来（真正干活的是 popup + worker）；
 *   2. popup 请求「填入当前页」时，用 chrome.scripting 把密码写进 password 输入框；
 *   3. 首次安装写一份默认状态并开设置页。
 *
 * 刻意不做的事：
 *   - 不在后台存主密钥、不监听页面输入、不在内容脚本里做任何派生；
 *   - 不申请 <all_urls> 常驻权限（只在用户点击时用 activeTab + scripting）。
 */

const MENU_ID = 'spectre-fill';

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '用 Spectre 填入密码',
      contexts: ['editable'],
    }, () => void chrome.runtime.lastError);
  });

  if (details.reason === 'install') {
    try {
      // 首次安装落一份默认状态，之后 options 页直接可读
      await chrome.storage.local.get('spectre_state');
      chrome.storage.local.set({
        spectre_state: {
          schemaVersion: 1,
          favorites: [],
          categories: [],
          recent: [],
          settings: { defaultType: 'long', algorithm: 3, autoFill: true, userName: '' },
        },
      });
    } catch (e) { /* 无所谓，popup 的 migrate 会兜底 */ }
  }
});

// 右键菜单：试图唤起 popup（Chrome 不允许脚本直接开 popup，退化成开选项页提示）
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  chrome.action.openPopup().catch(() => {
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { cmd: 'notify', text: '请点击工具栏的 Spectre 图标生成并填入密码' }).catch(() => {});
    }
  });
});

// 快捷键
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'fill-password') return;
  chrome.action.openPopup().catch(() => { /* 用户手点也一样 */ });
});

/**
 * popup 的填入请求。
 * 密码是在**这次消息里**传过来的，不由 service worker 保存；用完即弃。
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.cmd !== 'fill') return false;

  (async () => {
    try {
      const tabId = msg.tabId;
      if (!tabId) { sendResponse({ ok: false, error: '没有目标标签页' }); return; }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: false },
        args: [msg.password],
        func: fillPasswordFields,
      });
      const first = results && results[0] && results[0].result;
      const count = first && typeof first.count === 'number' ? first.count : 0;
      if (count > 0) sendResponse({ ok: true, count: count });
      else sendResponse({ ok: false, error: '页面里没找到可填的密码框' });
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    }
  })();

  return true; // 异步应答
});

// 注意：这个函数体是被序列化后注入页面的，不能引用外部作用域的任何变量。
function fillPasswordFields(password) {
  function visible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  let targets = [];
  const active = document.activeElement;
  if (active && active.tagName === 'INPUT' && active.type === 'password' && visible(active)) {
    targets = [active];
  } else {
    targets = Array.prototype.slice.call(
      document.querySelectorAll('input[type="password"]')
    ).filter(visible);
    // 优先取「表单里第一个密码框」，也就是最像登录密码的那个
    if (targets.length) targets = [targets[0]];
  }

  targets.forEach(function (el) { setValue(el, password); });
  if (targets[0] && typeof targets[0].focus === 'function') {
    try { targets[0].focus(); } catch (e) { /* ignore */ }
  }
  return { count: targets.length };
}

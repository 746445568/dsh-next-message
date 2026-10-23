import { createController } from '../lib/client-state.js';

export function createClient(React) {
  const h = React.createElement;
  function store(initial) {
    let value = initial; const listeners = new Set();
    return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, set(next) { value = next; for (const fn of listeners) fn(); } };
  }
  const settings = store({ config: null, revision: -1, error: '' });
  const runtime = store({ reason: 'loading', phase: 'idle', model: '' });
  let call;
  const words = {
    ready: '预测已就绪', loading: '正在连接插件', idle: '等待空输入框和完整回复', requesting: '正在生成下一句',
    disabled: '已关闭', 'no-suggestion': '这一轮没有合适的建议', 'missing-model': '请在 DSH 或插件设置中选择模型',
    'no-context': '当前会话暂无可用的完整对话', 'unfinished-turn': '等待本轮正常完成', timeout: '预测超时，本轮已跳过',
    'model-error': '模型请求失败，本轮已跳过', 'host-error': '会话读取失败', 'connection-error': '无法连接插件宿主',
    'incomplete-output': '模型输出不完整，本轮已跳过', 'invalid-output': '模型输出不符合格式', conflict: '检测到另一个灰字插件，已让出输入框',
    stale: '草稿或会话已变化，旧建议已撤下', cancelled: '已取消旧预测', accepted: '已填入草稿', dismissed: '已忽略本轮建议',
  };
  async function refreshConfig() {
    try {
      const r = await call({ action: 'config.get' });
      if (!r?.ok || !r.value?.config) throw new Error();
      settings.set({ ...r.value, error: '' });
    } catch { settings.set({ ...settings.getSnapshot(), error: '无法连接预测插件。请确认插件已启用，并重启 DSH。' }); }
  }
  function Seat(props) {
    const root = React.useRef(null), composing = React.useRef(false), latest = React.useRef(props), sessionHook = React.useRef(null);
    latest.current = props;
    const input = props.useInput(s => s);
    const running = props.useSession(s => s.running);
    const pending = props.useSession(s => !!s.pendingSubmissions?.length);
    sessionHook.current = { running, pending };
    const configState = React.useSyncExternalStore(settings.subscribe, settings.getSnapshot);
    const [, rerender] = React.useState(0);
    function editorOf() { return root.current?.closest('[data-composer-seat]')?.querySelector('[data-composer-input]') || null; }
    function read() {
      const p = latest.current, value = p.getInput?.() || input;
      const status = p.getSessionStatus?.();
      const seat = root.current?.closest('[data-composer-seat]');
      const foreign = seat?.querySelector('[data-composer-ghost]:not([data-composer-ghost="dsh-next-message"]), [data-dsh-next-step], [data-next-hint], [data-prompt-suggestions]');
      const visibleForeign = foreign && foreign.getClientRects().length > 0 && getComputedStyle(foreign).visibility !== 'hidden' && getComputedStyle(foreign).display !== 'none';
      const menu = [...document.querySelectorAll('[role="listbox"], [role="menu"]')].some(el => el.getClientRects().length > 0);
      return {
        sessionId: p.sessionId, running: status?.running ?? sessionHook.current.running, pending: !!status?.pendingInteraction || sessionHook.current.pending,
        draft: value.draft, draftRev: value.draftRev, phase: value.phase,
        attachments: value.attachmentIds?.length || 0, references: value.occurrences?.length || 0, queue: value.queue?.length || 0,
        composing: composing.current || editorOf()?.hasAttribute('data-composer-composing'), menu, conflict: !!visibleForeign,
      };
    }
    const controller = React.useMemo(() => createController({
      rpc: (payload, signal) => latest.current.call(payload, signal), read,
      changed(state) { runtime.set({ ...state, reason: state.reason }); rerender(n => n + 1); },
    }), []);
    React.useEffect(() => () => controller.dispose(), [controller]);
    React.useEffect(() => { controller.configure(configState.config, configState.revision); }, [controller, configState]);
    React.useEffect(() => { controller.update(); }, [controller, input, running, pending, props.sessionId]);
    React.useEffect(() => {
      const offInput = props.subscribeInput?.(() => controller.update());
      const offSession = props.subscribeSession?.(() => controller.update());
      return () => { offInput?.(); offSession?.(); };
    }, [controller, props.sessionId]);
    const state = controller.snapshot();
    React.useLayoutEffect(() => {
      const editor = editorOf();
      if (!editor || !state.text) return;
      const parent = editor.parentElement;
      const ghost = document.createElement('div');
      ghost.dataset.composerGhost = 'dsh-next-message'; ghost.setAttribute('aria-hidden', 'true');
      ghost.className = 'dsh-nm-ghost'; ghost.title = state.text;
      const text = document.createElement('span'); text.className = 'dsh-nm-ghost-text'; text.textContent = state.text;
      const badge = document.createElement('span'); badge.className = 'dsh-nm-key'; badge.textContent = 'Tab';
      ghost.append(text, badge); parent.append(ghost);
      const placeholder = parent.querySelector('[data-composer-placeholder]');
      const previousVisibility = placeholder?.style.visibility;
      if (placeholder) placeholder.style.visibility = 'hidden';
      const previousDescription = editor.getAttribute('aria-description');
      const description = `${state.text}。按 Tab 填入草稿，Esc 忽略。`;
      editor.setAttribute('aria-description', description);
      const measure = () => {
        const e = editor.getBoundingClientRect(), p = parent.getBoundingClientRect(), cs = getComputedStyle(editor);
        Object.assign(ghost.style, {
          top: `${e.top - p.top + parent.scrollTop + parseFloat(cs.paddingTop || '0')}px`,
          left: `${e.left - p.left + parseFloat(cs.paddingLeft || '0')}px`,
          width: `${Math.max(0, e.width - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0'))}px`,
          font: cs.font, lineHeight: cs.lineHeight,
        });
      };
      measure();
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
      observer?.observe(editor); window.addEventListener('resize', measure);
      return () => {
        observer?.disconnect(); window.removeEventListener('resize', measure); ghost.remove();
        if (placeholder?.style.visibility === 'hidden') placeholder.style.visibility = previousVisibility || '';
        if (editor.getAttribute('aria-description') === description) {
          if (previousDescription === null) editor.removeAttribute('aria-description'); else editor.setAttribute('aria-description', previousDescription);
        }
      };
    }, [state.text, props.sessionId]);
    React.useEffect(() => {
      const editor = editorOf(); if (!editor) return;
      const start = () => { composing.current = true; controller.update(); };
      const end = () => { composing.current = false; controller.update(); };
      const key = event => {
        if (event.isComposing || event.keyCode === 229 || composing.current || editor.hasAttribute('data-composer-composing')) return;
        if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.target !== editor && !editor.contains(event.target)) return;
        if (event.key !== 'Tab' && event.key !== 'Escape') return;
        controller.update();
        if (!controller.snapshot().text || !editor.parentElement.querySelector('[data-composer-ghost="dsh-next-message"]')) return;
        const handled = event.key === 'Escape' ? controller.dismiss() : controller.accept(text => {
          const actions = latest.current.inputActions;
          if (typeof actions?.captureInsertion !== 'function' || typeof actions?.insertText !== 'function') return false;
          const span = actions.captureInsertion();
          const live = read();
          if (live.draft !== '' || live.running !== false || live.composing) return false;
          const accepted = actions.insertText(text, span) === true;
          if (accepted) latest.current.focusInput?.();
          return accepted;
        });
        if (handled) { event.preventDefault(); event.stopImmediatePropagation(); }
      };
      editor.addEventListener('compositionstart', start); editor.addEventListener('compositionend', end);
      document.addEventListener('keydown', key, true);
      return () => { editor.removeEventListener('compositionstart', start); editor.removeEventListener('compositionend', end); document.removeEventListener('keydown', key, true); };
    }, [controller, props.sessionId]);
    return h('span', { ref: root, hidden: true, 'data-next-message-anchor': props.sessionId });
  }
  function Settings() {
    const saved = React.useSyncExternalStore(settings.subscribe, settings.getSnapshot);
    const status = React.useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
    const [draft, setDraft] = React.useState(null), [catalog, setCatalog] = React.useState([]), [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState(''), [stats, setStats] = React.useState(null);
    React.useEffect(() => { setDraft(saved.config); }, [saved]);
    React.useEffect(() => {
      let active = true;
      call({ action: 'catalog' }).then(r => { if (active && r?.ok) setCatalog(r.value); }).catch(() => {});
      call({ action: 'status' }).then(r => { if (active && r?.ok) setStats(r.value); }).catch(() => {});
      return () => { active = false; };
    }, []);
    if (!draft) return h('div', { className: 'dsh-nm-settings' }, h('h2', null, '下一句预测'), h('p', null, saved.error || '正在读取设置…'), h('button', { onClick: refreshConfig }, '重新连接'));
    const edit = patch => { setDraft({ ...draft, ...patch }); setNotice(''); };
    async function save() {
      setBusy(true); setNotice('');
      try {
        const r = await call({ action: 'config.set', config: draft, expectedRevision: saved.revision });
        if (!r?.ok) { setNotice(r?.error?.message === 'settings-conflict' ? '设置已在别处更新，已重新读取，请再修改。' : '保存失败，请检查服务商和模型是否成对选择。'); await refreshConfig(); return; }
        settings.set({ ...r.value, error: '' }); setNotice('已保存，立即生效。');
      } catch { setNotice('保存失败，原设置已保留。'); }
      finally { setBusy(false); }
    }
    const provider = catalog.find(p => p.id === draft.provider);
    const row = (label, control, help) => h('label', { className: 'dsh-nm-row' }, h('span', null, label, help && h('small', null, help)), control);
    const number = (key, min, max, step) => h('input', { type: 'number', min, max, step, value: draft[key], onChange: e => edit({ [key]: Number(e.target.value) }) });
    return h('div', { className: 'dsh-nm-settings' },
      h('h2', null, '下一句预测'), h('p', { className: 'dsh-nm-muted' }, '回复结束后，灰字建议你接下来可能说的话。Tab 填入草稿，Esc 忽略。'),
      row('启用预测', h('input', { type: 'checkbox', role: 'switch', checked: draft.enabled, onChange: e => edit({ enabled: e.target.checked }) })),
      row('模型来源', h('select', { value: draft.provider, onChange: e => edit({ provider: e.target.value, model: e.target.value ? catalog.find(p => p.id === e.target.value)?.models[0]?.id || '' : '' }) },
        h('option', { value: '' }, '跟随当前会话'), ...catalog.map(p => h('option', { key: p.id, value: p.id }, p.name))), '可单独选择已配置的快速模型。'),
      draft.provider && row('预测模型', h('select', { value: draft.model, onChange: e => edit({ model: e.target.value }) },
        ...(provider?.models || []).map(m => h('option', { key: m.id, value: m.id }, m.name)),
        !provider?.models?.some(m => m.id === draft.model) && h('option', { value: draft.model }, draft.model || '请选择模型'))),
      row('建议语言', h('select', { value: draft.language, onChange: e => edit({ language: e.target.value }) }, h('option', { value: 'auto' }, '跟随最近一条用户消息'), h('option', { value: 'zh' }, '中文'), h('option', { value: 'en' }, 'English'))),
      row('等待上限（毫秒）', number('timeoutMs', 1000, 10000, 500), '超过上限跳过本轮，避免迟到的建议。'),
      row('建议最长字符数', number('maxChars', 24, 160, 8)),
      row('上下文字数预算', number('contextChars', 3000, 24000, 1000)),
      h('div', { className: 'dsh-nm-actions' }, h('button', { onClick: save, disabled: busy }, busy ? '保存中…' : '保存设置'), h('span', { role: 'status' }, notice)),
      h('div', { className: 'dsh-nm-status' }, h('strong', null, '当前状态'), h('p', null, words[status.reason] || status.reason),
        h('p', { className: 'dsh-nm-muted' }, '每个完成回合最多一次模型请求。预测会使用所选模型的正常额度；没有自动发送。'),
        stats && h('small', null, `本次运行：请求 ${stats.requests} 次 · 缓存命中 ${stats.cacheHits} 次 · 接受 ${stats.accepted} 次`)),
    );
  }
  function apply(ctx) {
    call = (payload, signal) => ctx.connection.rpc.call('/api', 'dsh-next-message', payload, signal);
    ctx.effect(() => {
      const style = document.createElement('style');
      style.textContent = `.dsh-nm-ghost{position:absolute;z-index:1;pointer-events:none;color:var(--dsw-alias-label-caption,#8a8f98);user-select:none;box-sizing:border-box;padding-right:40px}.dsh-nm-ghost-text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-nm-key{position:absolute;right:0;top:1px;font:10px/17px system-ui,sans-serif;border:1px solid currentColor;border-radius:4px;padding:0 5px;opacity:.65}.dsh-nm-settings{max-width:700px;padding:24px;color:var(--dsw-alias-label-primary,inherit)}.dsh-nm-settings h2{font-size:20px;margin:0 0 10px}.dsh-nm-muted{opacity:.65;font-size:13px;line-height:1.7}.dsh-nm-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#8883);font-size:14px}.dsh-nm-row small{display:block;opacity:.6;font-size:12px;margin-top:5px}.dsh-nm-row select,.dsh-nm-row input[type=number]{max-width:280px;border:1px solid #8885;background:transparent;color:inherit;padding:7px 9px;border-radius:7px;font:inherit}.dsh-nm-row input[type=number]{width:110px}.dsh-nm-row input[type=checkbox]{width:18px;height:18px;accent-color:#2563eb}.dsh-nm-actions{display:flex;align-items:center;gap:12px;margin:22px 0;font-size:13px}.dsh-nm-actions button,.dsh-nm-settings>button{background:#2563eb;border:0;color:white;padding:9px 16px;border-radius:7px;cursor:pointer;font:inherit}.dsh-nm-actions button:disabled{opacity:.5;cursor:wait}.dsh-nm-status{padding:16px;border:1px solid #8883;border-radius:10px;font-size:13px;line-height:1.7}.dsh-nm-status p{margin:8px 0}`;
      document.head.append(style); return () => style.remove();
    });
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock', id: 'dsh-next-message', order: 85,
      inject(sessionId) {
        const scope = ctx.sessions.scope(sessionId), facade = scope && ctx.conversation.input.for(scope);
        let ui; try { ui = ctx.get('uiSession'); } catch {}
        return {
          call, getInput: () => facade?.state.getSnapshot(), focusInput: () => facade?.focus(),
          subscribeInput: fn => facade?.state.subscribe(fn),
          getSessionStatus: () => ui?.sessionStatus?.getSnapshot()?.get(sessionId),
          subscribeSession: fn => ui?.sessionStatus?.subscribe(fn),
        };
      },
    }, Seat));
    ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-next-message-settings', order: 60, label: '下一句预测' }, Settings));
    ctx.effect(() => { const fn = () => void refreshConfig(); window.addEventListener('focus', fn); return () => window.removeEventListener('focus', fn); });
    try { ctx.on('connection/reset', () => void refreshConfig()); } catch {}
    void refreshConfig();
  }
  return { inject: ['slots', 'sessions', 'conversation', 'connection'], apply };
}

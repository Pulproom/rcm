import { subscribeActivity } from './activity-state.js';
import { chipSkin } from './attention.js';
import { icon, escapeHtml } from './dashboard/film/ui.js';
import { addLog, saveSettings } from './settings.js';
import type { PluginSettings, RuntimeState } from './types.js';

export type Incident = {
  id: number; chatId: string | null; chatLabel: string | null;
  kind: 'job_failed' | 'worker_faulted' | 'upgrade_done' | 'upgrade_failed'; detail?: string;
};
export type IncidentFeed = { incidents: Incident[]; incidentCursor: number };
type Toast = { success: boolean; title: string; chatLabel?: string; subtitle?: string };
type Appearance = Pick<PluginSettings, 'dashboardSkin' | 'dashboardTheme'>;
const HOST = '[x-rcm-toasts]';

function toastCss(settings: Appearance): string {
  const s = chipSkin(settings), phone = settings.dashboardSkin === 'phone';
  return `${HOST}{position:fixed;z-index:2147483000;top:calc(env(safe-area-inset-top,0px) + 16px);right:16px;width:360px;max-width:calc(100vw - 24px);pointer-events:none;font-family:${s.sans}}
${HOST} .rcm-toast{box-sizing:border-box;display:grid;grid-template-columns:18px minmax(0,1fr);gap:3px 10px;padding:${phone ? '12px 14px' : '11px 13px'};border:${s.border};border-radius:${phone ? '16px' : '4px'};background:${phone && settings.dashboardTheme !== 'light' ? 'rgba(36,36,38,.86)' : s.screen};color:${s.ink};box-shadow:${s.shadow};backdrop-filter:${s.backdrop};-webkit-backdrop-filter:${s.backdrop};pointer-events:auto;cursor:pointer;touch-action:pan-y;animation:rcm-toast-in .18s ease-out}
${HOST} .rcm-toast:empty{height:0;padding:0;border:0;box-shadow:none;pointer-events:none;animation:none}
${HOST} svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;margin-top:1px;color:${s.cut}}
${HOST} [role=status] svg{color:${s.ok}}
${HOST} b{font-size:${phone ? 14 : 13}px;font-weight:600;line-height:1.45;overflow-wrap:anywhere}
${HOST} .who{color:${s.ink2};font-weight:500}
${HOST} small{grid-column:2;font-size:12px;line-height:1.45;color:${s.ink2}}
@media(max-width:600px){${HOST}{top:calc(env(safe-area-inset-top,0px) + 54px);left:12px;right:12px;width:auto;max-width:420px;margin-inline:auto}}
@media(prefers-reduced-transparency:reduce){${HOST} .rcm-toast{backdrop-filter:none;-webkit-backdrop-filter:none;background:${phone ? settings.dashboardTheme === 'light' ? '#fff' : '#242426' : s.screen}}}
@keyframes rcm-toast-in{from{transform:translateY(-6px)}to{transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){${HOST} .rcm-toast{animation:none}}`;
}

/** Adapter uses the same async element contract as getRootDocument. */
export function toastDocument(doc: Document): SafeRootDocument {
  const elements = new WeakMap<SafeRootElement, Element>();
  const wrap = (element: Element): SafeRootElement => {
    const result: SafeRootElement = {
      async appendChild(child) { element.appendChild(elements.get(child)!); },
      async remove() { element.remove(); },
      async setTextContent(value) { element.textContent = value; },
      async setInnerHTML(value) { element.innerHTML = value; },
      async setStyle(name,value) { (element as HTMLElement).style.setProperty(name,value); },
      async setAttribute(name,value) { element.setAttribute(name,value); },
      async addEventListener(type,callback) { element.addEventListener(type,callback); return type; },
      async getStyleAttribute() { return element.getAttribute('style') ?? ''; },
      async getBoundingClientRect() { return element.getBoundingClientRect(); },
      async clientWidth() { return element.clientWidth; }, async clientHeight() { return element.clientHeight; },
      async querySelector(selector) { const found=element.querySelector(selector); return found ? wrap(found) : null; },
    };
    elements.set(result,element); return result;
  };
  return {...wrap(doc.documentElement),async createElement(tag) { return wrap(doc.createElement(tag)); }};
}

class ToastHost {
  private queue: Toast[] = [];
  private seen = new Set<number>();
  private host?: SafeRootElement;
  private style?: SafeRootElement;
  private status?: SafeRootElement;
  private alert?: SafeRootElement;
  private timer?: ReturnType<typeof setTimeout>;
  private visibilityDocument?: Document;
  private stopVisibility?: () => void;
  private active?: Toast;
  private disposed = false;
  private work = Promise.resolve();
  stopObserving?: () => void;
  constructor(private settings: () => Appearance & Pick<PluginSettings,'majorAlerts'>) {}

  private serialize(work: () => Promise<void>): Promise<void> {
    this.work = this.work.catch(() => undefined).then(async () => { if (!this.disposed) await work(); });
    return this.work;
  }

  mount(root: SafeRootDocument, visibilityDocument: Document): Promise<void> {
    return this.serialize(async () => {
      this.cancelTimer(); this.stopVisibility?.();
      this.visibilityDocument=visibilityDocument;
      const update=()=>{ void this.serialize(async()=>this.syncDismissTimer()); };
      visibilityDocument.addEventListener('visibilitychange',update);
      visibilityDocument.defaultView?.addEventListener('focus',update);
      visibilityDocument.defaultView?.addEventListener('blur',update);
      this.stopVisibility=()=>{
        visibilityDocument.removeEventListener('visibilitychange',update);
        visibilityDocument.defaultView?.removeEventListener('focus',update);
        visibilityDocument.defaultView?.removeEventListener('blur',update);
      };
      await this.host?.remove();
      await (await root.querySelector(HOST))?.remove();
      const body = await root.querySelector('body');
      if (!body) return;
      this.host = await root.createElement('div');
      await this.host.setAttribute('x-rcm-toasts','true');
      // Only x- attributes may be set through SafeElement; roles live in sanitized HTML.
      await this.host.setInnerHTML('<div class="rcm-toast" role="status" aria-live="polite" aria-atomic="true" x-rcm-toast-status></div><div class="rcm-toast" role="alert" aria-live="assertive" aria-atomic="true" x-rcm-toast-alert></div>');
      await body.appendChild(this.host);
      this.style = await root.createElement('style');
      await this.host.appendChild(this.style);
      this.status = await this.host.querySelector('[x-rcm-toast-status]') ?? undefined;
      this.alert = await this.host.querySelector('[x-rcm-toast-alert]') ?? undefined;
      if (!this.style || !this.status || !this.alert) throw new Error('Toast live regions were removed by host HTML sanitization');
      let swipedAt=-Infinity;
      await this.host.addEventListener('click',() => { if (Date.now()-swipedAt>500) void this.dismiss(); });
      let press: {x:number;y:number} | undefined;
      await this.host.addEventListener('pointerdown',e => { press={x:e.clientX,y:e.clientY}; });
      await this.host.addEventListener('pointerup',e => {
        if (press && Math.hypot(e.clientX-press.x,e.clientY-press.y)>32) { swipedAt=Date.now(); void this.dismiss(); }
        press=undefined;
      });
      await this.paint();
      this.syncDismissTimer();
    });
  }

  enqueue(incidents: Incident[], enabled: boolean): Promise<void> {
    return this.serialize(async () => {
      const fresh=incidents.filter(item => { if (this.seen.has(item.id)) return false; this.seen.add(item.id); return true; });
      // Persisted feed cursor owns long-term deduplication; bound this session cache too.
      if (this.seen.size>1_000) this.seen=new Set([...this.seen].slice(-500));
      if (!enabled) { await this.clear(); return; }
      const chats=new Set(fresh.filter(item=>item.kind==='job_failed' && item.chatId).map(item=>item.chatId));
      let grouped=false;
      for (const item of fresh) {
        if (item.kind==='job_failed' && chats.size>1) {
          if (!grouped) this.queue.push({success:false,title:`채팅 ${chats.size}개에서 기억 만들기가 멈췄어요`});
          grouped=true; continue;
        }
        const title=item.kind==='upgrade_done' ? '새 버전으로 다시 만들었어요'
          : item.kind==='upgrade_failed' ? '다시 만들기를 마치지 못했어요'
          : item.kind==='worker_faulted' ? '기억 만들기가 멈췄어요 · 처리 상태에서 확인해 주세요' : '기억 만들기가 멈췄어요';
        this.queue.push({success:item.kind==='upgrade_done',title,chatLabel:item.chatLabel ?? undefined,
          subtitle:item.kind==='job_failed' ? '보조 모델 오류 · 처리 상태에서 볼 수 있어요' : undefined});
      }
      await this.next();
    });
  }

  reset(): Promise<void> {
    return this.serialize(async () => {
      this.seen.clear(); await this.clear();
    });
  }

  connection(enabled: boolean): Promise<void> {
    return this.serialize(async () => { if (enabled) { this.queue.push({success:false,title:'RCM 서버에 연결할 수 없어요'}); await this.next(); } });
  }
  private async paint(): Promise<void> {
    await this.style?.setTextContent(toastCss(this.settings()));
    const content=this.active ? `${icon(this.active.success ? 'check' : 'alert')}<b>${this.active.chatLabel ? `<span class="who">${escapeHtml(this.active.chatLabel)}</span> · ` : ''}${escapeHtml(this.active.title)}</b>${this.active.subtitle ? `<small>${escapeHtml(this.active.subtitle)}</small>` : ''}` : '';
    await this.status?.setInnerHTML(this.active?.success ? content : '');
    await this.alert?.setInnerHTML(this.active && !this.active.success ? content : '');
  }
  private async clear(): Promise<void> {
    this.queue=[]; this.active=undefined; this.cancelTimer(); await this.paint();
  }
  private visible(): boolean {
    const doc=this.visibilityDocument;
    return !!doc && (typeof doc.visibilityState === 'string' ? doc.visibilityState === 'visible' : doc.hasFocus());
  }
  private cancelTimer(): void {
    clearTimeout(this.timer); this.timer=undefined;
  }
  private syncDismissTimer(): void {
    if (!this.active || !this.visible()) { this.cancelTimer(); return; }
    if (this.timer !== undefined) return;
    const timer=setTimeout(()=>{
      void this.serialize(async()=>{
        if (this.timer !== timer) return;
        this.timer=undefined;
        // Recheck after pending paint/mount work and before consuming the queue.
        if (this.visible()) { this.active=undefined; await this.next(); }
      });
    },this.active.success ? 5_000 : 4_000);
    this.timer=timer;
  }
  private async next(): Promise<void> {
    if (this.settings().majorAlerts === false) { await this.clear(); return; }
    if (this.active) return;
    this.active=this.queue.shift(); await this.paint();
    this.syncDismissTimer();
  }
  dismiss(): Promise<void> {
    return this.serialize(async () => { this.cancelTimer(); this.active=undefined; await this.next(); });
  }
  async dispose(): Promise<void> {
    this.stopObserving?.(); this.stopObserving=undefined;
    this.stopVisibility?.(); this.stopVisibility=undefined;
    this.disposed=true; this.cancelTimer(); this.queue=[];
    await this.work.catch(()=>undefined); await this.host?.remove();
  }
}

let host: ToastHost | undefined;
let root: SafeRootDocument | undefined;
let dashboard: Document | undefined;

export async function installToasts(state: RuntimeState, rootDocument?: SafeRootDocument): Promise<void> {
  await host?.dispose();
  root=rootDocument ?? await risuai.getRootDocument();
  const installed=new ToastHost(()=>state.settings); host=installed;
  // SafeRoot has no visibility/focus getter. Page Visibility is shared by the host
  // tab and its plugin iframe, including when the iframe itself is CSS-hidden.
  await installed.mount(dashboard ? toastDocument(dashboard) : root,dashboard ?? document);
  installed.stopObserving=subscribeActivity(state,()=>{
    if (state.settings.majorAlerts === false) void installed.enqueue([],false).catch(()=>undefined);
  });
  state.notifyConnectionOutage=()=>{ void installed.connection(state.settings.majorAlerts !== false).catch(()=>undefined); };
  if (typeof risuai.onUnload === 'function') await risuai.onUnload(async () => {
    await installed.dispose(); if (host===installed) { host=undefined; root=undefined; dashboard=undefined; }
  });
}

export async function setToastDashboard(doc?: Document): Promise<void> {
  dashboard=doc;
  const target=doc ? toastDocument(doc) : root;
  if (host && target) await host.mount(target,doc ?? document).catch(()=>undefined);
}

export async function showToasts(incidents: Incident[], opts: {skin: Appearance; enabled: boolean}): Promise<void> {
  // Appearance is read from the runtime, including settings changes made in the dashboard.
  await host?.enqueue(incidents,opts.enabled);
}

/** Serialize both response paths: save BEFORE enqueue, and ignore an older in-flight response. */
const feeds=new WeakMap<RuntimeState,Promise<void>>();
export function consumeIncidentFeed(state: RuntimeState, feed: Partial<IncidentFeed>, serverUrl=state.settings.serverUrl, requestedCursor?: number): Promise<void> {
  const pending=(feeds.get(state) ?? Promise.resolve()).catch(()=>undefined).then(async () => {
    if (state.unloaded || state.settings.serverUrl!==serverUrl || !Number.isSafeInteger(feed.incidentCursor) || !Array.isArray(feed.incidents)) return;
    const previous=state.settings.incidentServerUrl===serverUrl ? state.settings.incidentCursor : undefined;
    const previousServer=state.settings.incidentServerUrl;
    const cursor=feed.incidentCursor!;
    const reset=previous!==undefined && cursor<previous && requestedCursor===previous && feed.incidents.length===0;
    if (previous!==undefined && cursor<=previous && !reset) return;
    state.settings.incidentCursor=cursor;
    state.settings.incidentServerUrl=serverUrl;
    try { await saveSettings(state.settings); }
    catch (error) { state.settings.incidentCursor=previous; state.settings.incidentServerUrl=previousServer; addLog(state.logs,'warn','Incident cursor could not be saved'); return; }
    try {
      if (reset || previousServer!==serverUrl) await host?.reset();
      if (!reset) await showToasts(feed.incidents.filter(item=>previous===undefined || item.id>previous),{skin:state.settings,enabled:state.settings.majorAlerts !== false});
    } catch { addLog(state.logs,'warn','Major alert could not be rendered'); }
  });
  feeds.set(state,pending); return pending;
}

export function incidentCursorQuery(settings: Pick<PluginSettings,'incidentCursor'|'incidentServerUrl'|'serverUrl'>): string {
  return settings.incidentServerUrl===settings.serverUrl && settings.incidentCursor!==undefined ? `incidentCursor=${settings.incidentCursor}` : '';
}

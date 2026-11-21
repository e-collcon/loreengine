/**
 * The HUD (spec 6.9): a DOM overlay with the player's health, health bars
 * over damaged entities, the interact prompt, and `show-message` toasts.
 * `hudModel` is the pure part: what to show, read from the runtime view.
 */
import type { DrawList } from '@loreengine/render';
import type { RuntimeView } from '@loreengine/runtime/view';

export interface HudBar {
  /** Entity index. */
  entity: number;
  fraction: number;
  /** Screen position: centered above the sprite. */
  x: number;
  y: number;
}

export interface HudModel {
  /** The player's health, or null when there is no player. */
  player: { hp: number; max: number } | null;
  bars: HudBar[];
  /** The interact prompt of whatever the interact key would use, or null. */
  prompt: string | null;
  outcome: 'victory' | 'defeat' | null;
}

/** At most this many health bars are shown. */
export const MAX_BARS = 64;

export function hudModel(view: RuntimeView, list: DrawList): HudModel {
  const e = view.entities;
  const p = e.playerIndex();
  const bars: HudBar[] = [];
  for (let i = 0; i < list.count && bars.length < MAX_BARS; i++) {
    if (list.kind[i] !== 1) continue;
    const index = list.ref[i]!;
    // Bars sit over damaged entities only; the player's health has its own readout.
    if (index === p || e.dead(index) || e.hpMax(index) <= 0 || e.hp(index) >= e.hpMax(index)) continue;
    bars.push({ entity: index, fraction: e.hp(index) / e.hpMax(index), x: list.footX[index]!, y: list.top[index]! - 8 });
  }
  const target = view.interactTarget();
  const prompt = target >= 0 ? (e.data(target).interactable?.prompt ?? null) : null;
  return { player: p >= 0 ? { hp: e.hp(p), max: e.hpMax(p) } : null, bars, prompt, outcome: view.outcome };
}

/** HUD styling from the LoreEngine design system (dark glass). Fonts fall back to the system when a page has not loaded them. */
const SANS = "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif";
const PIXEL = "'Departure Mono', ui-monospace, Menlo, monospace";
const GLASS = 'background:rgba(27,32,30,.78);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),inset 0 0 0 1px rgba(255,255,255,.07),0 0 0 1px rgba(0,0,0,.45),0 12px 28px -10px rgba(0,0,0,.6)';

/** The DOM overlay. Create it over the canvas; call `update` once a frame. */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly health: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly toasts: HTMLDivElement;
  private readonly bars: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private cursor: number;
  private readonly live: { el: HTMLDivElement; until: number }[] = [];

  constructor(host: HTMLElement, view: RuntimeView) {
    const el = (css: string, parent: HTMLElement): HTMLDivElement => {
      const d = document.createElement('div');
      d.style.cssText = css;
      parent.appendChild(d);
      return d;
    };
    this.root = el(`position:absolute;inset:0;pointer-events:none;font:500 13px/1.4 ${SANS};color:#edf2ef;overflow:hidden`, host);
    this.health = el(`position:absolute;left:16px;bottom:16px;width:220px;height:14px;padding:2px;${GLASS};border-radius:999px`, this.root);
    this.healthFill = el('height:100%;background:#f05a46;border-radius:999px;width:100%;box-shadow:inset 0 1px 0 rgba(255,255,255,.35)', this.health);
    this.prompt = el(`position:absolute;left:50%;bottom:64px;transform:translateX(-50%);padding:7px 14px;${GLASS};border-radius:999px;display:none`, this.root);
    this.toasts = el('position:absolute;left:50%;top:18%;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center', this.root);
    this.bars = el('position:absolute;inset:0', this.root);
    this.banner = el(`position:absolute;inset:0;display:none;align-items:center;justify-content:center;font:400 44px/1 ${PIXEL};background:rgba(11,14,13,.55);letter-spacing:.04em`, this.root);
    this.cursor = view.presentation.end;
  }

  update(view: RuntimeView, list: DrawList, interactKey: string, nowMs: number): void {
    const model = hudModel(view, list);
    this.health.style.display = model.player ? 'block' : 'none';
    if (model.player) this.healthFill.style.width = `${Math.max(0, (model.player.hp / model.player.max) * 100)}%`;
    this.prompt.style.display = model.prompt === null ? 'none' : 'block';
    if (model.prompt !== null) this.prompt.textContent = `${interactKey}  ${model.prompt}`;

    // Health bars: reuse elements, hide the spare ones.
    while (this.bars.children.length < model.bars.length) {
      const bar = document.createElement('div');
      bar.style.cssText = 'position:absolute;width:44px;height:5px;margin-left:-22px;background:rgba(11,14,13,.75);box-shadow:0 0 0 1px rgba(0,0,0,.6);border-radius:999px';
      const fill = document.createElement('div');
      fill.style.cssText = 'height:100%;background:#f2b84b;border-radius:999px';
      bar.appendChild(fill);
      this.bars.appendChild(bar);
    }
    for (let i = 0; i < this.bars.children.length; i++) {
      const bar = this.bars.children[i] as HTMLDivElement;
      const m = model.bars[i];
      bar.style.display = m ? 'block' : 'none';
      if (!m) continue;
      bar.style.left = `${m.x}px`;
      bar.style.top = `${m.y}px`;
      (bar.firstChild as HTMLDivElement).style.width = `${m.fraction * 100}%`;
    }

    // show-message toasts.
    this.cursor = view.presentation.since(this.cursor, (event) => {
      if (event.kind !== 'message') return;
      const toast = document.createElement('div');
      toast.textContent = event.s;
      toast.style.cssText = `padding:8px 16px;${GLASS};border-radius:999px;font-size:15px;font-weight:500`;
      this.toasts.appendChild(toast);
      this.live.push({ el: toast, until: nowMs + event.n });
    });
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (nowMs >= this.live[i]!.until) {
        this.live[i]!.el.remove();
        this.live.splice(i, 1);
      }
    }
    this.banner.style.display = model.outcome ? 'flex' : 'none';
    if (model.outcome) this.banner.textContent = model.outcome === 'victory' ? 'VICTORY' : 'DEFEAT';
  }

  destroy(): void {
    this.root.remove();
  }
}

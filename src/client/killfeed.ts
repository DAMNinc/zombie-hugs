import { readableText } from './arena';
import { safeColor } from './lobbyModel';
import { evictIndex, mergeIndex } from './brawlModel';

const MAX_ENTRIES = 8;
const FADE_TIME_MS = 5000;
const STRONG_FADE_TIME_MS = 9000;

interface FeedEntry {
  text: string;
  timestamp: number;
  element: HTMLDivElement;
  key?: string;
  count: number;
  strong: boolean;
}

export interface AddOptions {
  /** Same key as the newest line (within the merge window) turns it into "text ×N" instead of a new line. */
  mergeKey?: string;
  /** Builds the line text for a repeat count (default: the plain text, then "text ×N"). */
  format?: (count: number) => string;
  /** Knockouts and other big moments: bolder, with a border. */
  strong?: boolean;
  /** Brawl: the line sits on a pill in this (seat) colour with readable text, so every seat colour is legible. */
  badge?: string;
}

const MERGE_WINDOW_MS = 4000;

export default class KillFeed {
  private container: HTMLDivElement;
  private entries: FeedEntry[] = [];
  private maxEntries = MAX_ENTRIES;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'kill-feed';
    this.container.style.cssText = `
      position: fixed;
      top: 60px;
      right: 10px;
      width: 300px;
      z-index: 9998;
      pointer-events: none;
      font-family: monospace;
      font-size: 13px;
    `;
    document.body.appendChild(this.container);

    setInterval(() => this.cleanup(), 1000);
  }

  /** Brawl: fewer lines (phones) so sustained traffic stays readable. */
  setMaxEntries(n: number): void {
    this.maxEntries = Math.max(1, n);
    this.trim();
  }

  add(text: string, color: string = '#fff', opts: AddOptions = {}): void {
    const at = opts.mergeKey ? mergeIndex(this.entries, opts.mergeKey, Date.now(), MERGE_WINDOW_MS) : -1;
    if (at >= 0) {
      const [top] = this.entries.splice(at, 1);
      this.entries.unshift(top);
      this.container.insertBefore(top.element, this.container.firstChild);
      top.count += 1;
      top.timestamp = Date.now();
      top.text = opts.format ? opts.format(top.count) : `${text} \u00D7${top.count}`;
      top.element.textContent = top.text;
      top.element.style.opacity = '1';
      return;
    }
    const el = document.createElement('div');
    el.style.cssText = `
      background: rgba(0,0,0,0.7);
      color: ${color};
      padding: 4px 8px;
      margin-bottom: 2px;
      border-radius: 3px;
      transition: opacity 0.5s;
    `;
    if (opts.badge) {
      el.style.background = safeColor(opts.badge);
      el.style.color = readableText(safeColor(opts.badge));
    }
    if (opts.strong) {
      el.style.fontWeight = 'bold';
      el.style.border = '2px solid #fff';
    }
    el.className = 'kill-line';
    el.textContent = opts.format ? opts.format(1) : text;

    this.container.insertBefore(el, this.container.firstChild);
    this.entries.unshift({ text, timestamp: Date.now(), element: el, key: opts.mergeKey, count: 1, strong: !!opts.strong });
    this.trim();
  }

  private trim(): void {
    while (this.entries.length > this.maxEntries) {
      // Knockouts and captures outlive ordinary lines: evict the oldest ordinary one first.
      const [old] = this.entries.splice(evictIndex(this.entries), 1);
      if (old.element.parentNode) this.container.removeChild(old.element);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    this.entries = this.entries.filter(entry => {
      if (now - entry.timestamp > (entry.strong ? STRONG_FADE_TIME_MS : FADE_TIME_MS)) {
        entry.element.style.opacity = '0';
        setTimeout(() => {
          if (entry.element.parentNode) {
            this.container.removeChild(entry.element);
          }
        }, 500);
        return false;
      }
      return true;
    });
  }
}

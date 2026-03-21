const MAX_ENTRIES = 8;
const FADE_TIME_MS = 5000;

interface FeedEntry {
  text: string;
  timestamp: number;
  element: HTMLDivElement;
}

export default class KillFeed {
  private container: HTMLDivElement;
  private entries: FeedEntry[] = [];

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

  add(text: string, color: string = '#fff'): void {
    const el = document.createElement('div');
    el.style.cssText = `
      background: rgba(0,0,0,0.7);
      color: ${color};
      padding: 4px 8px;
      margin-bottom: 2px;
      border-radius: 3px;
      transition: opacity 0.5s;
    `;
    el.textContent = text;

    this.container.insertBefore(el, this.container.firstChild);
    this.entries.unshift({ text, timestamp: Date.now(), element: el });

    // Trim excess
    while (this.entries.length > MAX_ENTRIES) {
      const old = this.entries.pop()!;
      this.container.removeChild(old.element);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    this.entries = this.entries.filter(entry => {
      if (now - entry.timestamp > FADE_TIME_MS) {
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

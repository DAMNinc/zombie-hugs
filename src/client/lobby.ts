import {
  LobbyPayload, LobbySeat, isLobbyPhase, modeLabel, seatedHumans, seatStatus, invitePrompt,
  queueBannerText, endPracticeLabel, queuePosition, droppedText, reconnectSeconds,
} from './lobbyModel';

export interface LobbyCallbacks {
  onReady: (ready: boolean) => void;
  onReturn: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Room lobby: four seats, ready toggle, invite link, queue banner, practice/reconnect notices. */
export default class Lobby {
  private panel = el('div', 'lobby-panel');
  private title = el('div', 'lobby-title');
  private seatList = el('ul', 'lobby-seats');
  private hint = el('div', 'lobby-hint');
  private readyBtn = el('button', 'lobby-btn lobby-ready');
  private linkInput = el('input', 'lobby-link');
  private copyBtn = el('button', 'lobby-btn lobby-copy', 'Copy link');
  private banner = el('div', 'lobby-banner');
  private endBtn = el('button', 'lobby-btn lobby-end');
  private notices = el('div', 'lobby-notices');
  private dropped = new Map<string, { name: string; until: number }>();
  private dropTimer: ReturnType<typeof setInterval> | null = null;
  private last: LobbyPayload | null = null;
  private myId = '';
  private queued = false;
  private queuePos = 0;
  private myReady = false;
  private flashes: string[] = [];

  constructor(private cb: LobbyCallbacks) {
    this.linkInput.type = 'text';
    this.linkInput.readOnly = true;
    this.linkInput.setAttribute('aria-label', 'Invite link');
    this.linkInput.addEventListener('focus', () => this.linkInput.select());
    this.copyBtn.addEventListener('click', () => this.copyLink());
    this.readyBtn.addEventListener('click', () => this.cb.onReady(!this.myReady));
    this.endBtn.addEventListener('click', () => this.cb.onReturn());

    const linkRow = el('div', 'lobby-linkrow');
    linkRow.append(this.linkInput, this.copyBtn);
    this.panel.append(this.title, this.seatList, this.hint, this.readyBtn, el('div', 'lobby-invite-label', 'Invite link'), linkRow);

    for (const e of [this.panel, this.banner, this.endBtn, this.notices]) e.style.display = 'none';
    this.panel.setAttribute('role', 'region');
    this.panel.setAttribute('aria-label', 'Room lobby');
    this.banner.setAttribute('role', 'status');
    this.notices.setAttribute('role', 'status');
    document.body.append(this.panel, this.banner, this.endBtn, this.notices);
  }

  setMyId(id: string): void { this.myId = id; this.render(); }

  /** The server queued this socket: show the spectator banner until promoted. */
  setQueued(position: number): void {
    this.queued = true;
    this.queuePos = position;
    document.body.classList.add('queued-spectator'); // hides the player-only HUD
    this.render();
  }

  /** Promoted to a seat: leave the spectator state. */
  clearQueued(): void {
    this.queued = false;
    this.queuePos = 0;
    document.body.classList.remove('queued-spectator');
    this.render();
  }

  /** A seated player left for good: drop their reconnect notice. */
  playerLeft(id: string): void {
    this.dropped.delete(id);
    this.renderNotices();
  }

  update(payload: LobbyPayload): void {
    this.last = payload;
    if (this.queued) {
      const pos = queuePosition(payload.queue, this.myId);
      if (pos > 0) this.queuePos = pos;
    }
    this.render();
  }

  playerDropped(id: string, until: number): void {
    const name = this.last?.seats.find((s) => s && s.id === id)?.name || 'A player';
    this.dropped.set(id, { name, until });
    if (!this.dropTimer) this.dropTimer = setInterval(() => this.renderNotices(), 500);
    this.renderNotices();
  }

  playerReconnected(id: string): void {
    const d = this.dropped.get(id);
    this.dropped.delete(id);
    if (d) this.flash(`${d.name} is back`);
    this.renderNotices();
  }

  private flash(text: string): void {
    this.flashes.push(text);
    this.renderNotices();
    setTimeout(() => { this.flashes.shift(); this.renderNotices(); }, 2500);
  }

  private renderNotices(): void {
    const now = Date.now();
    const lines: string[] = [];
    for (const [id, d] of this.dropped) {
      const secs = reconnectSeconds(d.until, now);
      if (now >= d.until && secs === 0) { this.dropped.delete(id); continue; }
      lines.push(droppedText(d.name, secs));
    }
    lines.push(...this.flashes);
    if (this.dropped.size === 0 && this.dropTimer) { clearInterval(this.dropTimer); this.dropTimer = null; }
    this.notices.replaceChildren(...lines.map((t) => el('div', 'lobby-notice', t)));
    this.notices.style.display = lines.length ? 'flex' : 'none';
  }

  private render(): void {
    const p = this.last;
    const me: LobbySeat | null = p ? (p.seats.find((s) => s && s.id === this.myId) as LobbySeat | undefined) || null : null;
    const inLobby = !!p && !!me && isLobbyPhase(p.phase);

    // Spectator queue banner
    if (this.queued && !me) {
      this.banner.textContent = queueBannerText(this.queuePos);
      this.banner.style.display = 'block';
    } else {
      this.banner.style.display = 'none';
    }

    // End practice (solo match in progress)
    const soloPlaying = !!p && !!me && p.mode === 'solo' && p.phase !== 'lobby' && p.phase !== 'match_over';
    if (soloPlaying) {
      const waiting = p!.queue.length > 0;
      this.endBtn.textContent = endPracticeLabel(p!.queue);
      this.endBtn.classList.toggle('lobby-end-urgent', waiting);
      this.endBtn.style.display = 'block';
    } else {
      this.endBtn.style.display = 'none';
    }

    if (!inLobby || !p || !me) {
      this.panel.style.display = 'none';
      return;
    }

    const humans = seatedHumans(p.seats);
    this.myReady = me.ready;
    this.title.textContent = modeLabel(p.mode, humans.length);
    this.hint.textContent = p.phase === 'countdown' ? 'Get ready…' : invitePrompt(p.mode, humans.length);

    this.seatList.replaceChildren(...p.seats.map((s, i) => this.seatRow(s, i, s !== null && s.id === this.myId)));

    this.readyBtn.textContent = me.ready ? 'Not ready' : 'Ready';
    this.readyBtn.classList.toggle('lobby-ready-on', me.ready);
    this.readyBtn.disabled = p.phase === 'countdown';

    this.linkInput.value = window.location.origin + p.invitePath;
    this.panel.style.display = 'flex';
  }

  private seatRow(s: LobbySeat | null, index: number, mine: boolean): HTMLLIElement {
    const li = el('li', 'lobby-seat');
    if (mine) li.classList.add('lobby-seat-me');
    if (!s) li.classList.add('lobby-seat-open');
    const badge = el('span', 'lobby-badge', String((s ? s.seat : index) + 1));
    if (s) badge.style.background = s.color;
    const name = el('span', 'lobby-name', s ? s.name + (mine ? ' (you)' : '') : 'Open');
    const status = el('span', 'lobby-status', seatStatus(s));
    if (s && !s.isBot && s.connected) status.classList.add(s.ready ? 'is-ready' : 'not-ready');
    if (!s) { name.textContent = ''; name.style.display = 'none'; status.classList.add('lobby-status-open'); }
    li.append(badge, name, status);
    return li;
  }

  private copyLink(): void {
    const done = () => {
      this.copyBtn.textContent = 'Copied!';
      setTimeout(() => { this.copyBtn.textContent = 'Copy link'; }, 1500);
    };
    const fallback = () => {
      this.linkInput.focus();
      this.linkInput.select();
      this.linkInput.setSelectionRange(0, this.linkInput.value.length);
      try { if (document.execCommand('copy')) done(); } catch (_e) { /* text stays selected */ }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(this.linkInput.value).then(done, fallback);
    } else {
      fallback();
    }
  }
}

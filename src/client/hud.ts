import Constants from './constants';

export default class HUD {
  private container: HTMLDivElement;
  private hpBar: HTMLDivElement;
  private hpText: HTMLSpanElement;
  private scoreText: HTMLSpanElement;
  private opponentScoreText: HTMLSpanElement;
  private opponentHpBar: HTMLDivElement;
  private countdownOverlay: HTMLDivElement;
  private gameOverOverlay: HTMLDivElement;
  private roundIndicator: HTMLDivElement;
  private comboText: HTMLDivElement;
  private shieldCooldown: HTMLDivElement;
  private upgradeIndicator: HTMLDivElement;
  private pingDisplay: HTMLDivElement;
  private latencyMs: number = 0;
  private isSpectator: boolean;

  // New feature elements
  private powerUpIndicator: HTMLDivElement;
  private chargeBar: HTMLDivElement;
  private synergyText: HTMLDivElement;
  private suddenDeathBanner: HTMLDivElement;
  private eloDisplay: HTMLDivElement;
  private cameraModeIndicator: HTMLDivElement;
  private spectatorPanel: HTMLDivElement;

  constructor(isSpectator: boolean = false) {
    this.isSpectator = isSpectator;

    // Main HUD container
    this.container = document.createElement('div');
    this.container.id = 'hud';
    this.container.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 9990; font-family: monospace;
    `;
    document.body.appendChild(this.container);

    // Player HP bar (bottom-left)
    const hpContainer = document.createElement('div');
    hpContainer.style.cssText = `
      position: fixed; bottom: 30px; left: 10px;
      width: 200px; height: 20px;
      background: #333; border: 2px solid #555; border-radius: 3px;
    `;
    this.hpBar = document.createElement('div');
    this.hpBar.style.cssText = `
      width: 100%; height: 100%; background: #4caf50;
      transition: width 0.3s; border-radius: 2px;
    `;
    hpContainer.appendChild(this.hpBar);
    this.hpText = document.createElement('span');
    this.hpText.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 12px; text-shadow: 1px 1px 2px #000;
    `;
    this.hpText.textContent = `HP: ${Constants.MAX_HP}/${Constants.MAX_HP}`;
    hpContainer.appendChild(this.hpText);
    this.container.appendChild(hpContainer);

    // Score area (top-center)
    const opponentContainer = document.createElement('div');
    opponentContainer.id = 'opponent-hud';
    opponentContainer.style.cssText = `
      position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 20px; align-items: center;
      background: rgba(0,0,0,0.6); padding: 8px 16px; border-radius: 5px;
      color: #fff; font-size: 14px;
    `;

    const myScoreSection = document.createElement('div');
    myScoreSection.innerHTML = '<span style="color:#4caf50">YOU</span>';
    this.scoreText = document.createElement('span');
    this.scoreText.style.cssText = 'font-size: 24px; font-weight: bold; margin-left: 8px;';
    this.scoreText.textContent = '0';
    myScoreSection.appendChild(this.scoreText);
    opponentContainer.appendChild(myScoreSection);

    this.roundIndicator = document.createElement('div');
    this.roundIndicator.style.cssText = 'color: #aaa; font-size: 12px; text-align: center;';
    this.roundIndicator.textContent = 'Round 1';
    opponentContainer.appendChild(this.roundIndicator);

    const oppScoreSection = document.createElement('div');
    oppScoreSection.innerHTML = '<span style="color:#f44336">OPP</span>';
    this.opponentScoreText = document.createElement('span');
    this.opponentScoreText.style.cssText = 'font-size: 24px; font-weight: bold; margin-left: 8px;';
    this.opponentScoreText.textContent = '0';
    oppScoreSection.appendChild(this.opponentScoreText);
    opponentContainer.appendChild(oppScoreSection);

    this.container.appendChild(opponentContainer);

    // HP mini bars
    const oppHpContainer = document.createElement('div');
    oppHpContainer.style.cssText = `
      position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
      width: 300px; height: 8px; display: flex; gap: 4px;
    `;
    const myHpMini = document.createElement('div');
    myHpMini.style.cssText = 'flex: 1; background: #333; border-radius: 2px; overflow: hidden;';
    const myHpBarMini = document.createElement('div');
    myHpBarMini.id = 'my-hp-mini';
    myHpBarMini.style.cssText = 'width: 100%; height: 100%; background: #4caf50; transition: width 0.3s;';
    myHpMini.appendChild(myHpBarMini);

    const oppHpMini = document.createElement('div');
    oppHpMini.style.cssText = 'flex: 1; background: #333; border-radius: 2px; overflow: hidden;';
    this.opponentHpBar = document.createElement('div');
    this.opponentHpBar.style.cssText = 'width: 100%; height: 100%; background: #f44336; transition: width 0.3s;';
    oppHpMini.appendChild(this.opponentHpBar);

    oppHpContainer.appendChild(myHpMini);
    oppHpContainer.appendChild(oppHpMini);
    this.container.appendChild(oppHpContainer);

    // Countdown overlay
    this.countdownOverlay = document.createElement('div');
    this.countdownOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.5);
      color: #fff; font-size: 120px; font-weight: bold;
      text-shadow: 0 0 40px rgba(255,255,255,0.5);
    `;
    this.container.appendChild(this.countdownOverlay);

    // Game over overlay
    this.gameOverOverlay = document.createElement('div');
    this.gameOverOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: none; align-items: center; justify-content: center; flex-direction: column;
      background: rgba(0,0,0,0.8); color: #fff; font-size: 48px;
      pointer-events: auto;
    `;
    this.container.appendChild(this.gameOverOverlay);

    // Combo text
    this.comboText = document.createElement('div');
    this.comboText.style.cssText = `
      position: fixed; top: 40%; left: 50%; transform: translate(-50%, -50%);
      color: #ff0; font-size: 36px; font-weight: bold;
      text-shadow: 0 0 20px rgba(255,255,0,0.8);
      display: none; transition: opacity 0.3s;
    `;
    this.container.appendChild(this.comboText);

    // Shield cooldown bar
    this.shieldCooldown = document.createElement('div');
    this.shieldCooldown.style.cssText = `
      position: fixed; bottom: 55px; left: 10px;
      width: 200px; height: 12px;
      background: #333; border: 1px solid #555; border-radius: 2px;
      display: block;
    `;
    const shieldBar = document.createElement('div');
    shieldBar.id = 'shield-bar';
    shieldBar.style.cssText = 'width: 100%; height: 100%; background: #2196f3; border-radius: 2px; transition: width 0.1s;';
    this.shieldCooldown.appendChild(shieldBar);
    const shieldLabel = document.createElement('span');
    shieldLabel.style.cssText = `
      position: absolute; top: -14px; left: 0; font-size: 10px; color: #aaa;
    `;
    shieldLabel.textContent = 'SHIELD [Q]';
    this.shieldCooldown.appendChild(shieldLabel);
    this.container.appendChild(this.shieldCooldown);

    // Upgrade indicator
    this.upgradeIndicator = document.createElement('div');
    this.upgradeIndicator.style.cssText = `
      position: fixed; bottom: 75px; left: 10px;
      color: #ff0; font-size: 12px; display: none;
    `;
    this.container.appendChild(this.upgradeIndicator);

    // Ping display
    this.pingDisplay = document.createElement('div');
    this.pingDisplay.style.cssText = `
      position: fixed; bottom: 5px; right: 5px;
      color: #888; font-size: 11px; font-family: monospace;
    `;
    this.container.appendChild(this.pingDisplay);

    // === NEW FEATURE HUD ELEMENTS ===

    // Power-up indicator (bottom-left, above upgrade)
    this.powerUpIndicator = document.createElement('div');
    this.powerUpIndicator.style.cssText = `
      position: fixed; bottom: 95px; left: 10px;
      font-size: 12px; display: none;
    `;
    this.container.appendChild(this.powerUpIndicator);

    // Charge bar (bottom-center)
    this.chargeBar = document.createElement('div');
    this.chargeBar.style.cssText = `
      position: fixed; bottom: 70px; left: 50%; transform: translateX(-50%);
      width: 150px; height: 8px;
      background: #333; border: 1px solid #555; border-radius: 2px;
      display: none;
    `;
    const chargeInner = document.createElement('div');
    chargeInner.id = 'charge-inner';
    chargeInner.style.cssText = 'width: 0%; height: 100%; background: #ff6600; border-radius: 2px; transition: width 0.05s;';
    this.chargeBar.appendChild(chargeInner);
    const chargeLabel = document.createElement('span');
    chargeLabel.style.cssText = 'position: absolute; top: -14px; left: 0; font-size: 10px; color: #aaa;';
    chargeLabel.textContent = 'CHARGE [HOLD]';
    this.chargeBar.appendChild(chargeLabel);
    this.container.appendChild(this.chargeBar);

    // Synergy text (center, slightly below combo)
    this.synergyText = document.createElement('div');
    this.synergyText.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      color: #0ff; font-size: 28px; font-weight: bold;
      text-shadow: 0 0 20px rgba(0,255,255,0.8);
      display: none; transition: opacity 0.3s;
    `;
    this.container.appendChild(this.synergyText);

    // Sudden death banner (top)
    this.suddenDeathBanner = document.createElement('div');
    this.suddenDeathBanner.style.cssText = `
      position: fixed; top: 65px; left: 50%; transform: translateX(-50%);
      background: rgba(255,0,0,0.8); color: #fff; padding: 4px 16px;
      border-radius: 3px; font-size: 14px; font-weight: bold;
      display: none; animation: pulse 1s infinite;
    `;
    this.suddenDeathBanner.textContent = 'SUDDEN DEATH';
    this.container.appendChild(this.suddenDeathBanner);

    // Add pulse animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
      @keyframes glow { 0%,100% { text-shadow: 0 0 10px currentColor; } 50% { text-shadow: 0 0 20px currentColor, 0 0 40px currentColor; } }
    `;
    document.head.appendChild(style);

    // ELO display (bottom-left corner)
    this.eloDisplay = document.createElement('div');
    this.eloDisplay.style.cssText = `
      position: fixed; bottom: 5px; left: 10px;
      color: #888; font-size: 11px; font-family: monospace;
      display: none;
    `;
    this.container.appendChild(this.eloDisplay);

    // Camera mode indicator (bottom-right, above ping)
    this.cameraModeIndicator = document.createElement('div');
    this.cameraModeIndicator.style.cssText = `
      position: fixed; bottom: 20px; right: 5px;
      color: #888; font-size: 11px; font-family: monospace;
    `;
    this.cameraModeIndicator.textContent = '1ST PERSON [V]';
    this.container.appendChild(this.cameraModeIndicator);

    // Spectator vote panel (only for spectators)
    this.spectatorPanel = document.createElement('div');
    this.spectatorPanel.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      display: none; gap: 8px; pointer-events: auto;
      background: rgba(0,0,0,0.7); padding: 8px 12px; border-radius: 5px;
    `;
    this.container.appendChild(this.spectatorPanel);

    if (isSpectator) {
      this.setupSpectatorPanel();
    }
  }

  private setupSpectatorPanel(): void {
    this.spectatorPanel.style.display = 'flex';
    const votes = [
      { type: 'speed_burst', label: 'Speed Burst', color: '#ff6600' },
      { type: 'spawn_obstacle', label: 'Spawn Wall', color: '#2196f3' },
      { type: 'heal_all', label: 'Heal All', color: '#4caf50' },
    ];

    const title = document.createElement('span');
    title.style.cssText = 'color: #aaa; font-size: 12px; display: flex; align-items: center; margin-right: 8px;';
    title.textContent = 'INTERFERE:';
    this.spectatorPanel.appendChild(title);

    for (const v of votes) {
      const btn = document.createElement('button');
      btn.style.cssText = `
        padding: 6px 12px; font-size: 12px; font-family: monospace;
        background: rgba(0,0,0,0.8); color: ${v.color}; border: 1px solid ${v.color};
        border-radius: 3px; cursor: pointer; pointer-events: auto;
      `;
      btn.textContent = v.label;
      btn.dataset.voteType = v.type;
      this.spectatorPanel.appendChild(btn);
    }
  }

  getSpectatorPanel(): HTMLDivElement {
    return this.spectatorPanel;
  }

  updateScore(myScore: number, opponentScore: number): void {
    this.scoreText.textContent = String(myScore);
    this.opponentScoreText.textContent = String(opponentScore);

    const oldScore = document.getElementById('score');
    if (oldScore) oldScore.innerHTML = String(myScore);
  }

  updateHP(myHp: number, opponentHp: number): void {
    const myPct = (myHp / Constants.MAX_HP) * 100;
    const oppPct = (opponentHp / Constants.MAX_HP) * 100;

    this.hpBar.style.width = myPct + '%';
    this.hpBar.style.background = myPct > 50 ? '#4caf50' : myPct > 25 ? '#ff9800' : '#f44336';
    this.hpText.textContent = `HP: ${myHp}/${Constants.MAX_HP}`;

    this.opponentHpBar.style.width = oppPct + '%';

    const myMini = document.getElementById('my-hp-mini');
    if (myMini) {
      myMini.style.width = myPct + '%';
      myMini.style.background = myPct > 50 ? '#4caf50' : myPct > 25 ? '#ff9800' : '#f44336';
    }
  }

  showCountdown(seconds: number): void {
    this.countdownOverlay.style.display = 'flex';
    this.countdownOverlay.textContent = String(seconds);
  }

  hideCountdown(): void {
    this.countdownOverlay.style.display = 'none';
  }

  showGameStart(): void {
    this.countdownOverlay.textContent = 'GO!';
    this.suddenDeathBanner.style.display = 'none';
    setTimeout(() => this.hideCountdown(), 800);
  }

  showRoundEnd(winnerName: string, round: number, iWon: boolean): void {
    this.gameOverOverlay.style.display = 'flex';
    this.gameOverOverlay.innerHTML = `
      <div style="font-size: 36px; color: ${iWon ? '#4caf50' : '#f44336'};">
        ${iWon ? 'ROUND WON!' : 'ROUND LOST'}
      </div>
      <div style="font-size: 18px; color: #aaa; margin-top: 10px;">
        Round ${round} - ${winnerName} wins
      </div>
      <div style="font-size: 14px; color: #666; margin-top: 20px;">
        Next round starting...
      </div>
    `;
    setTimeout(() => {
      this.gameOverOverlay.style.display = 'none';
    }, 2500);
  }

  showMatchOver(winnerName: string, iWon: boolean, roundWins: Record<string, number>, stats: Record<string, any>, myId: string, opponentId: string, elo?: Record<string, number>, leaderboard?: Array<{ name: string; elo: number }>): void {
    const myStats = stats[myId] || {};
    const oppStats = stats[opponentId] || {};
    const myElo = elo?.[myId] || '';
    const oppElo = elo?.[opponentId] || '';

    let leaderboardHtml = '';
    if (leaderboard && leaderboard.length > 0) {
      leaderboardHtml = `
        <div style="margin-top: 20px; font-size: 13px; color: #aaa;">
          <div style="font-weight: bold; margin-bottom: 6px;">LEADERBOARD</div>
          ${leaderboard.slice(0, 5).map((entry, i) =>
            `<div style="color: ${i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#888'};">
              #${i + 1} ${entry.name} - ${entry.elo} ELO
            </div>`
          ).join('')}
        </div>
      `;
    }

    this.gameOverOverlay.style.display = 'flex';
    this.gameOverOverlay.innerHTML = `
      <div style="font-size: 64px; color: ${iWon ? '#4caf50' : '#f44336'}; margin-bottom: 20px;">
        ${iWon ? 'VICTORY!' : 'DEFEAT'}
      </div>
      <div style="font-size: 18px; color: #aaa; margin-bottom: 10px;">
        ${winnerName} wins the match!
      </div>
      ${myElo ? `<div style="font-size: 14px; color: #ff0; margin-bottom: 20px;">Your ELO: ${myElo} | Opponent ELO: ${oppElo}</div>` : ''}
      <table style="font-size: 14px; color: #ccc; border-collapse: collapse; min-width: 400px;">
        <tr style="border-bottom: 1px solid #444;">
          <th style="padding: 8px; text-align: left;">Stat</th>
          <th style="padding: 8px; text-align: center; color: #4caf50;">You</th>
          <th style="padding: 8px; text-align: center; color: #f44336;">Opponent</th>
        </tr>
        <tr><td style="padding: 6px;">Rounds Won</td><td style="text-align:center">${roundWins[myId] || 0}</td><td style="text-align:center">${roundWins[opponentId] || 0}</td></tr>
        <tr><td style="padding: 6px;">Creatures Fired</td><td style="text-align:center">${myStats.zombiesFired || 0}</td><td style="text-align:center">${oppStats.zombiesFired || 0}</td></tr>
        <tr><td style="padding: 6px;">Scored</td><td style="text-align:center">${myStats.zombiesScored || 0}</td><td style="text-align:center">${oppStats.zombiesScored || 0}</td></tr>
        <tr><td style="padding: 6px;">Destroyed</td><td style="text-align:center">${myStats.zombiesDestroyed || 0}</td><td style="text-align:center">${oppStats.zombiesDestroyed || 0}</td></tr>
      </table>
      ${leaderboardHtml}
      <div style="display: flex; gap: 12px; margin-top: 20px;">
        <button id="rematch-btn" style="
          padding: 12px 40px; font-size: 20px;
          background: #4caf50; color: #fff; border: none; border-radius: 5px;
          cursor: pointer; pointer-events: auto;
        ">REMATCH</button>
        <button id="replay-btn" style="
          padding: 12px 30px; font-size: 16px;
          background: #2196f3; color: #fff; border: none; border-radius: 5px;
          cursor: pointer; pointer-events: auto;
        ">WATCH REPLAY</button>
      </div>
      <div id="rematch-status" style="font-size: 14px; color: #888; margin-top: 10px;"></div>
    `;
  }

  hideMatchOver(): void {
    this.gameOverOverlay.style.display = 'none';
  }

  showCombo(count: number): void {
    this.comboText.textContent = `COMBO x${count}!`;
    this.comboText.style.display = 'block';
    this.comboText.style.opacity = '1';
    setTimeout(() => {
      this.comboText.style.opacity = '0';
      setTimeout(() => { this.comboText.style.display = 'none'; }, 300);
    }, 1500);
  }

  updateShieldCooldown(ready: boolean, pct: number): void {
    const bar = document.getElementById('shield-bar');
    if (bar) {
      bar.style.width = (pct * 100) + '%';
      bar.style.background = ready ? '#2196f3' : '#666';
    }
  }

  showUpgrade(level: number): void {
    this.upgradeIndicator.style.display = 'block';
    const stars = '\u2605'.repeat(level);
    this.upgradeIndicator.textContent = `UPGRADE ${stars}`;
    this.upgradeIndicator.style.color = level >= 2 ? '#ff4444' : '#ff0';
  }

  updateRound(round: number, roundWins?: Record<string, number>, myId?: string, opponentId?: string): void {
    let text = `Round ${round}`;
    if (roundWins && myId && opponentId) {
      text += ` | ${roundWins[myId] || 0} - ${roundWins[opponentId] || 0}`;
    }
    this.roundIndicator.textContent = text;
  }

  updatePing(ms: number): void {
    this.latencyMs = ms;
    const color = ms < 50 ? '#4caf50' : ms < 100 ? '#ff9800' : '#f44336';
    this.pingDisplay.innerHTML = `<span style="color:${color}">${ms}ms</span>`;
  }

  // === NEW FEATURE METHODS ===

  updateCharge(pct: number): void {
    if (pct > 0) {
      this.chargeBar.style.display = 'block';
      const inner = document.getElementById('charge-inner');
      if (inner) {
        inner.style.width = (pct * 100) + '%';
        // Color goes from orange to red as charge increases
        const r = 255;
        const g = Math.round(102 * (1 - pct));
        inner.style.background = `rgb(${r},${g},0)`;
      }
    } else {
      this.chargeBar.style.display = 'none';
    }
  }

  showPowerUp(type: string): void {
    const labels: Record<string, { text: string; color: string }> = {
      rapid_fire: { text: 'RAPID FIRE', color: '#ff6600' },
      speed_boost: { text: 'SPEED BOOST', color: '#00ff88' },
      double_points: { text: '2X POINTS', color: '#ff0' },
    };
    const info = labels[type];
    if (!info) return;

    this.powerUpIndicator.style.display = 'block';
    this.powerUpIndicator.style.color = info.color;
    this.powerUpIndicator.textContent = `\u26A1 ${info.text}`;
    this.powerUpIndicator.style.animation = 'glow 1s infinite';
  }

  hidePowerUp(): void {
    this.powerUpIndicator.style.display = 'none';
  }

  showSynergy(type: string): void {
    const names: Record<string, string> = {
      air_strike: 'AIR STRIKE!',
      stampede: 'STAMPEDE!',
      juggernaut: 'JUGGERNAUT!',
      twin_strike: 'TWIN STRIKE!',
    };
    this.synergyText.textContent = names[type] || type.toUpperCase() + '!';
    this.synergyText.style.display = 'block';
    this.synergyText.style.opacity = '1';
    setTimeout(() => {
      this.synergyText.style.opacity = '0';
      setTimeout(() => { this.synergyText.style.display = 'none'; }, 300);
    }, 2000);
  }

  showSuddenDeath(): void {
    this.suddenDeathBanner.style.display = 'block';
  }

  hideSuddenDeath(): void {
    this.suddenDeathBanner.style.display = 'none';
  }

  updateElo(elo: number): void {
    this.eloDisplay.style.display = 'block';
    this.eloDisplay.textContent = `ELO: ${elo}`;
  }

  updateCameraMode(thirdPerson: boolean): void {
    this.cameraModeIndicator.textContent = thirdPerson ? '3RD PERSON [V]' : '1ST PERSON [V]';
  }

  showReplayControls(replay: any[], onPlay: () => void): void {
    // Show a simple replay indicator
    const overlay = document.createElement('div');
    overlay.id = 'replay-overlay';
    overlay.style.cssText = `
      position: fixed; top: 10px; right: 10px;
      background: rgba(33,150,243,0.8); color: #fff;
      padding: 8px 16px; border-radius: 5px;
      font-size: 14px; font-weight: bold; z-index: 9999;
    `;
    overlay.textContent = `REPLAY - ${replay.length} events`;
    document.body.appendChild(overlay);
  }

  hideReplayControls(): void {
    const overlay = document.getElementById('replay-overlay');
    if (overlay) overlay.remove();
  }

  // Mobile weapon buttons
  createMobileWeaponButtons(onSelect: (code: number) => void): void {
    if (!('ontouchstart' in window)) return;

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
      position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 8px; pointer-events: auto;
    `;

    const weapons = [
      { code: 1, label: 'Fox', color: '#ff6600' },
      { code: 2, label: 'Horse', color: '#aa8833' },
      { code: 3, label: 'Flamingo', color: '#ff69b4' },
      { code: 4, label: 'Zombie', color: '#33ff33' },
      { code: 5, label: 'Horde', color: '#9933ff' },
    ];

    for (const w of weapons) {
      const btn = document.createElement('button');
      btn.style.cssText = `
        padding: 8px 14px; font-size: 14px; font-family: monospace;
        background: rgba(0,0,0,0.7); color: ${w.color}; border: 2px solid ${w.color};
        border-radius: 5px; pointer-events: auto;
      `;
      btn.textContent = `${w.code}:${w.label}`;
      btn.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        onSelect(w.code);
      });
      btnContainer.appendChild(btn);
    }

    this.container.appendChild(btnContainer);
  }
}

import Constants from './constants';

export default class HUD {
  private container: HTMLDivElement;
  private hpBar: HTMLDivElement;
  private hpText: HTMLSpanElement;
  private scoreText: HTMLSpanElement;
  private opponentScoreText: HTMLSpanElement;
  private opponentHpBar: HTMLDivElement;
  private opponentHpText: HTMLSpanElement;
  private countdownOverlay: HTMLDivElement;
  private gameOverOverlay: HTMLDivElement;
  private roundIndicator: HTMLDivElement;
  private comboText: HTMLDivElement;
  private shieldCooldown: HTMLDivElement;
  private upgradeIndicator: HTMLDivElement;
  private pingDisplay: HTMLDivElement;
  private latencyMs: number = 0;
  private isSpectator: boolean;

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

    // Player score (top-right, replaces old score)
    this.scoreText = document.createElement('span');
    // Will be managed by the existing #score element

    // Opponent info (top-left)
    const opponentContainer = document.createElement('div');
    opponentContainer.id = 'opponent-hud';
    opponentContainer.style.cssText = `
      position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 20px; align-items: center;
      background: rgba(0,0,0,0.6); padding: 8px 16px; border-radius: 5px;
      color: #fff; font-size: 14px;
    `;

    // Your score
    const myScoreSection = document.createElement('div');
    myScoreSection.innerHTML = '<span style="color:#4caf50">YOU</span>';
    this.scoreText = document.createElement('span');
    this.scoreText.style.cssText = 'font-size: 24px; font-weight: bold; margin-left: 8px;';
    this.scoreText.textContent = '0';
    myScoreSection.appendChild(this.scoreText);
    opponentContainer.appendChild(myScoreSection);

    // Round indicator
    this.roundIndicator = document.createElement('div');
    this.roundIndicator.style.cssText = 'color: #aaa; font-size: 12px; text-align: center;';
    this.roundIndicator.textContent = 'Round 1';
    opponentContainer.appendChild(this.roundIndicator);

    // Opponent score
    const oppScoreSection = document.createElement('div');
    oppScoreSection.innerHTML = '<span style="color:#f44336">OPP</span>';
    this.opponentScoreText = document.createElement('span');
    this.opponentScoreText.style.cssText = 'font-size: 24px; font-weight: bold; margin-left: 8px;';
    this.opponentScoreText.textContent = '0';
    oppScoreSection.appendChild(this.opponentScoreText);
    opponentContainer.appendChild(oppScoreSection);

    this.container.appendChild(opponentContainer);

    // Opponent HP bar
    const oppHpContainer = document.createElement('div');
    oppHpContainer.style.cssText = `
      position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
      width: 300px; height: 8px; display: flex; gap: 4px;
    `;
    // My HP mini
    const myHpMini = document.createElement('div');
    myHpMini.style.cssText = 'flex: 1; background: #333; border-radius: 2px; overflow: hidden;';
    this.opponentHpBar = document.createElement('div'); // reuse for opponent
    // Actually let's make separate bars
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

    this.opponentHpText = document.createElement('span'); // unused but keep ref

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
      display: none;
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
    this.shieldCooldown.style.display = 'block';

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
  }

  updateScore(myScore: number, opponentScore: number): void {
    this.scoreText.textContent = String(myScore);
    this.opponentScoreText.textContent = String(opponentScore);

    // Also update old score element for backward compat
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

  showMatchOver(winnerName: string, iWon: boolean, roundWins: Record<string, number>, stats: Record<string, any>, myId: string, opponentId: string): void {
    const myStats = stats[myId] || {};
    const oppStats = stats[opponentId] || {};

    this.gameOverOverlay.style.display = 'flex';
    this.gameOverOverlay.innerHTML = `
      <div style="font-size: 64px; color: ${iWon ? '#4caf50' : '#f44336'}; margin-bottom: 20px;">
        ${iWon ? 'VICTORY!' : 'DEFEAT'}
      </div>
      <div style="font-size: 18px; color: #aaa; margin-bottom: 30px;">
        ${winnerName} wins the match!
      </div>
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
      <button id="rematch-btn" style="
        margin-top: 30px; padding: 12px 40px; font-size: 20px;
        background: #4caf50; color: #fff; border: none; border-radius: 5px;
        cursor: pointer; pointer-events: auto;
      ">REMATCH</button>
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
      { code: 4, label: 'Horde', color: '#33ff33' },
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

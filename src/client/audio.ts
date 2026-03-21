type SoundName = 'fire' | 'collision' | 'score' | 'damage' | 'weapon_switch' | 'countdown' | 'game_start' | 'game_over' | 'shield' | 'combo' | 'powerup' | 'sudden_death' | 'synergy' | 'wall' | 'charged_fire';

// Procedurally generated sound effects using Web Audio API
export default class Audio {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;

  constructor() {
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      this.enabled = false;
    }

    const resume = () => {
      if (this.ctx?.state === 'suspended') {
        this.ctx.resume();
      }
    };
    window.addEventListener('click', resume, { once: true });
    window.addEventListener('touchstart', resume, { once: true });
  }

  play(name: SoundName): void {
    if (!this.enabled || !this.ctx) return;

    switch (name) {
      case 'fire':
        this.playTone(200, 0.1, 'square', 0.3);
        break;
      case 'collision':
        this.playNoise(0.15, 0.5);
        break;
      case 'score':
        this.playTone(600, 0.1, 'sine', 0.3);
        setTimeout(() => this.playTone(800, 0.15, 'sine', 0.3), 100);
        break;
      case 'damage':
        this.playTone(150, 0.2, 'sawtooth', 0.4);
        break;
      case 'weapon_switch':
        this.playTone(400, 0.05, 'sine', 0.2);
        break;
      case 'countdown':
        this.playTone(440, 0.15, 'sine', 0.4);
        break;
      case 'game_start':
        this.playTone(440, 0.1, 'sine', 0.4);
        setTimeout(() => this.playTone(660, 0.1, 'sine', 0.4), 100);
        setTimeout(() => this.playTone(880, 0.2, 'sine', 0.4), 200);
        break;
      case 'game_over':
        this.playTone(440, 0.2, 'sine', 0.4);
        setTimeout(() => this.playTone(330, 0.2, 'sine', 0.4), 200);
        setTimeout(() => this.playTone(220, 0.4, 'sine', 0.4), 400);
        break;
      case 'shield':
        this.playTone(300, 0.1, 'triangle', 0.3);
        setTimeout(() => this.playTone(500, 0.15, 'triangle', 0.3), 50);
        break;
      case 'combo':
        this.playTone(700, 0.08, 'sine', 0.3);
        setTimeout(() => this.playTone(900, 0.08, 'sine', 0.3), 80);
        setTimeout(() => this.playTone(1100, 0.12, 'sine', 0.3), 160);
        break;
      case 'powerup':
        this.playTone(500, 0.08, 'sine', 0.3);
        setTimeout(() => this.playTone(700, 0.08, 'sine', 0.3), 60);
        setTimeout(() => this.playTone(900, 0.08, 'sine', 0.3), 120);
        setTimeout(() => this.playTone(1200, 0.12, 'sine', 0.3), 180);
        break;
      case 'sudden_death':
        this.playTone(200, 0.3, 'sawtooth', 0.5);
        setTimeout(() => this.playTone(150, 0.3, 'sawtooth', 0.5), 300);
        setTimeout(() => this.playTone(100, 0.5, 'sawtooth', 0.6), 600);
        break;
      case 'synergy':
        this.playTone(600, 0.1, 'triangle', 0.3);
        setTimeout(() => this.playTone(800, 0.1, 'triangle', 0.3), 100);
        setTimeout(() => this.playTone(1000, 0.1, 'triangle', 0.3), 200);
        setTimeout(() => this.playTone(1200, 0.15, 'triangle', 0.4), 300);
        break;
      case 'wall':
        this.playTone(250, 0.15, 'square', 0.3);
        setTimeout(() => this.playTone(300, 0.1, 'square', 0.2), 100);
        break;
      case 'charged_fire':
        this.playTone(150, 0.05, 'square', 0.4);
        this.playTone(300, 0.15, 'square', 0.4);
        setTimeout(() => this.playTone(400, 0.1, 'square', 0.3), 100);
        break;
    }
  }

  private playTone(freq: number, duration: number, type: OscillatorType, volume: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  private playNoise(duration: number, volume: number): void {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
  }
}

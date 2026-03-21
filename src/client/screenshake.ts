export default class ScreenShake {
  private camera: any;
  private shaking: boolean = false;
  private elapsed: number = 0;
  private duration: number = 0.3;
  private intensity: number = 10;
  private originalX: number = 0;
  private originalY: number = 0;

  constructor(camera: any) {
    this.camera = camera;
  }

  trigger(intensity: number = 10): void {
    this.shaking = true;
    this.elapsed = 0;
    this.intensity = intensity;
    this.originalX = this.camera.position.x;
    this.originalY = this.camera.position.y;
  }

  update(elapsed: number): void {
    if (!this.shaking) return;

    this.elapsed += elapsed;
    if (this.elapsed >= this.duration) {
      this.shaking = false;
      this.camera.position.y = this.originalY;
      return;
    }

    const decay = 1 - (this.elapsed / this.duration);
    const offsetX = (Math.random() - 0.5) * 2 * this.intensity * decay;
    const offsetY = (Math.random() - 0.5) * 2 * this.intensity * decay;

    this.camera.position.x = this.originalX + offsetX;
    this.camera.position.y = this.originalY + offsetY;
  }
}

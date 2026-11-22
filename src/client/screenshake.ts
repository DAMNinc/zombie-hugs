// Shakes the camera by adding a temporary offset on top of its logical position.
// Call clear() before the camera controller moves the camera each frame and update()
// after it, so the offset never leaks into the position the controller (and the server) sees.
export default class ScreenShake {
  private camera: any;
  private shaking: boolean = false;
  private elapsed: number = 0;
  private duration: number = 0.3;
  private intensity: number = 10;
  private appliedX: number = 0;
  private appliedY: number = 0;

  constructor(camera: any) {
    this.camera = camera;
  }

  trigger(intensity: number = 10): void {
    this.shaking = true;
    this.elapsed = 0;
    this.intensity = intensity;
  }

  /** Remove the offset applied last frame, restoring the logical camera position. */
  clear(): void {
    this.camera.position.x -= this.appliedX;
    this.camera.position.y -= this.appliedY;
    this.appliedX = 0;
    this.appliedY = 0;
  }

  /** Advance the shake and apply this frame's offset. */
  update(elapsed: number): void {
    this.clear();
    if (!this.shaking) return;

    this.elapsed += elapsed;
    if (this.elapsed >= this.duration) {
      this.shaking = false;
      return;
    }

    const decay = 1 - (this.elapsed / this.duration);
    this.appliedX = (Math.random() - 0.5) * 2 * this.intensity * decay;
    this.appliedY = (Math.random() - 0.5) * 2 * this.intensity * decay;
    this.camera.position.x += this.appliedX;
    this.camera.position.y += this.appliedY;
  }
}

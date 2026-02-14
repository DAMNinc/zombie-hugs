export default class Console {
  static log(text: string): void {
    window.console.log(text);
  }

  static info(text: string): void {
    window.console.log(text);
    const consoleEl = document.getElementById('console');
    if (consoleEl) {
      consoleEl.scrollTop = consoleEl.scrollHeight;
      consoleEl.append(text + '\n');
    }
  }

  static error(text: string): void {
    window.console.error(text);
  }
}

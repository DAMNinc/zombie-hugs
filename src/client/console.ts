class Console {
  static log(text: string): void {
    window.console.log(text);
  }

  static info(text: string): void {
    window.console.log(text);
    const consoleElem = document.getElementById('console');
    if (consoleElem) {
      consoleElem.scrollTop = consoleElem.scrollHeight;
      consoleElem.append(text + '\n');
    }
  }

  static error(text: string): void {
    window.console.error(text);
  }
}

export default Console;

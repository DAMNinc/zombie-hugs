export default class Score {
  static update(score: number): void {
    // Perhaps a bit overkill with a whole class for this.
    const scoreElem = document.getElementById('score');
    if (scoreElem) {
      scoreElem.innerHTML = String(score);
    }
  }
}

'use strict';

class Score {

  static update(score) {
    // Perhaps a bit overkill with a whole class for this.
    var scoreElem = document.getElementById('score');
    scoreElem.innerHTML = score;
  }
}

module.exports = Score;
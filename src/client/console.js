'use strict';

class Console {

    static log(text) {
        window.console.log(text);
    }

    static info(text) {
        window.console.log(text);
        var console = document.getElementById('console');
        console.scrollTop = console.scrollHeight;
        console.append(text + '\n');
    }

    static error(text) {
        window.console.error(text);
    }

}

module.exports = Console;
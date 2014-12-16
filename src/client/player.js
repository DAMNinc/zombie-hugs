var Fox = require('./fox');

// The camera and game should never be exposed in the public API for the player.
var camera = null,
    game = null;


/**
 * Represents a playable character.
 * The character is controllable with keyboard and mouse.
 */
function Player(gam, cam) {
    camera = cam;
    game = gam;
    this.forward = false;
    this.backward = false;
    this.left = false;
    this.right = false;

    // Register the player for key events.
    var self = this;
    var startMoveEvent = function(keyEvent) {
        console.log('Key down ' + keyEvent.keyCode);
        self.toggleMovement(keyEvent.keyCode, true);
    }

    var endMoveEvent = function(keyEvent) {
        console.log('Key up ' + keyEvent.keyCode);
        self.toggleMovement(keyEvent.keyCode, false);
    }

    var mouseClickEvent = function(ev) {
        console.log('Click');
        self.fire();
    };

    window.addEventListener('keydown', startMoveEvent);
    window.addEventListener('keyup', endMoveEvent);
    window.addEventListener('click', mouseClickEvent);
}

Player.prototype.toggleMovement = function (keyCode, directionBool) {
    switch (keyCode) {
        case 37:  // Leftarrow
        case 65:  // a key
            this.left = directionBool;
            break;
        case 38:  // Up arrow
        case 87:  // w key
            this.forward = directionBool;
            break;
        case 39:  // Right arrow
        case 68:  // d key
            this.right = directionBool;
            break;
        case 40:  // Down arrow
        case 83:  // s key
            this.backward = directionBool;
            break;
    }
};

Player.prototype.fire = function() {
    var fox = new Fox();

    // Set the fox at the camera position.
    // The fox is "standing over the y-axis" so a little bit is
    // subtracted from the y-axis coordinate.
    fox.foxObj.mesh.position.x = camera.position.x;
    fox.foxObj.mesh.position.y = camera.position.y-50;
    fox.foxObj.mesh.position.z = camera.position.z;

    // Rotate 180 degrees to face away from player.
    fox.foxObj.mesh.rotation.y = Math.PI;

    // Add to scene and fox array.
    game.addZombie(fox);
};

Player.prototype.update = function (elapsed) {
    var curPosX = camera.position.x;
    var curPosZ = camera.position.z;

    // How much to move.
    var tr = 100.0;

    if (this.left) {
        curPosX -= tr*elapsed;
    }
    else if (this.right) {
        curPosX += tr*elapsed;
    }

    camera.position.x = curPosX;
    camera.position.z = curPosZ;
};

module.exports = Player;

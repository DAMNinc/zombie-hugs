var Fox = require('./fox');

function Player(scene, camera) {
    this.forward = false;
    this.backward = false;
    this.left = false;
    this.right = false;
    this.camera = camera;
    this.scene = scene;



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
    fox.foxObj.mesh.position.x = this.camera.position.x;
    fox.foxObj.mesh.position.y = this.camera.position.y-50;
    fox.foxObj.mesh.position.z = this.camera.position.z;

    // Rotate 180 degrees to face away from player.
    fox.foxObj.mesh.rotation.y = Math.PI;

    // Add to scene and fox array.
    window.spheres.push(fox);
    this.scene.add(fox.foxObj.mesh);
};

Player.prototype.updatePosition = function (elapsed) {
    var curPosX = this.camera.position.x;
    var curPosZ = this.camera.position.z;
    var curRot = this.camera.rotation.y;

    var tr = 5.0;
    var rot = 0.025;


    //if (this.forward) {
    //    // For free movement:
    //    //curPosX -= Math.sin(-curRot) * -tr;
    //    //curPosZ -= Math.cos(-curRot) * tr;
    //    curPosZ -= tr;
    //}
    //else if (this.backward) {
    //    // For free movement:
    //    //curPosX -= Math.sin(curRot) * -tr;
    //    //curPosZ += Math.cos(curRot) * tr;
    //    curPosZ += tr;
    //}

    if (this.left) {
        curPosX -= tr;
        // For free movement.
        //curRot += rot;
    }
    else if (this.right) {
        // For free movement.
        //curRot -= rot;
        curPosX += tr;
    }

    this.camera.rotation.y = curRot;
    this.camera.position.x = curPosX;
    this.camera.position.z = curPosZ;
}

module.exports = Player;

(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
window.spheres = [];
var camera, scene, renderer,
    player = null,
    clock = null,
    windowWidth = window.innerWidth-100,
    windowHeight = window.innerHeight-100,
    windowDepth = 1000,
    maxwidth = windowWidth/2,
    maxheight = windowHeight/2,
    maxdepth = windowDepth/2,
    
    animating = false,
    Player = require('./player'),
    Sphere = require('./sphere');

function init() {

    // Init scene and camera.
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, windowWidth / windowHeight, 1, 10000);
    camera.position.z = 2000;

    var pointLight = new THREE.PointLight(0xffffff);
    pointLight.position.x = maxwidth - 50;
    pointLight.position.y = maxheight - 50;
    pointLight.position.z = maxdepth - 50;
    scene.add( pointLight );

    // Init timetaking
    clock = new THREE.Clock(true);

    // Init objects
    player = new Player(scene, camera);
    
    // Init renderer.
    renderer = new THREE.WebGLRenderer({ alpha: true });
    renderer.setSize( windowWidth, windowHeight );

    var renderarea = document.getElementById('render-area');
    if (renderarea.hasChildNodes())
        renderarea.removeChild(renderarea.childNodes[0]);
    renderarea.appendChild(renderer.domElement);

}

function animate() {
    if (animating) {
        var elapsed = clock.getDelta();

        for (var i = 0; i < spheres.length; i++) {
            spheres[i].updatePosition(elapsed);
        }

        player.updatePosition(elapsed);

        // note: three.js includes requestAnimationFrame shim
        window.animationId = requestAnimationFrame( animate );
        render();
    } 
}

function render() {
    renderer.render( scene, camera );
}

var Zombie = function() {};

Zombie.prototype.start = function() {
    if (window.animationId !== null)
        cancelAnimationFrame(window.animationId);
    init();
    animating = true;
    animate();
}

Zombie.prototype.stop = function() {
    animating = false;
}

window.Zombie = new Zombie();

},{"./player":2,"./sphere":3}],2:[function(require,module,exports){
  var Sphere = require('./sphere');
  var sphereRadius = 30;

   function Player(scene, camera) {
        this.forward = false;
        this.backward = false;
        this.left = false;
        this.right = false;
        this.camera = camera;
        this.scene = scene;

        this.toggleMovement = function (keyCode, directionBool) {
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
        }

        this.updatePosition = function (elapsed) {
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
            self.createSphere();
        };

        window.addEventListener('keydown', startMoveEvent);
        window.addEventListener('keyup', endMoveEvent);
        window.addEventListener('click', mouseClickEvent);
    }

    Player.prototype.createSphere = function() {
        var geometry = new THREE.SphereGeometry(sphereRadius, 10, 10);
        var material = new THREE.MeshLambertMaterial({ color: 0xff0000 });
        var mesh =  new THREE.Mesh(geometry, material);
        mesh.position.z = this.camera.position.z;
        mesh.position.x = this.camera.position.x;
        var sphere = new Sphere(mesh);
        window.spheres.push(sphere);
        this.scene.add(sphere.mesh);
    };

    module.exports = Player;
},{"./sphere":3}],3:[function(require,module,exports){
/**
 * Represents a single sphere. Later, this will turn into a zombie!
 */
function Sphere(mesh) {
    this.mesh = mesh;
    this.direction = [ 
        Math.round(Math.random()) == 1 ? 1 : -1, 
        Math.round(Math.random()) == 1 ? 1 : -1,
        Math.round(Math.random()) == 1 ? 1 : -1
    ];

    // Speed will be between 400 and 600 pixels per millisecond.
    this.speed = 1000; // Math.random() * 200 + 400;

    this.updatePosition = function (elapsed) {
        this.mesh.position.z -= elapsed * this.speed;
        //this.mesh.position.x += this.direction[0] * ;
        //this.mesh.position.y += this.direction[1] * (elapsed / 1000.0 * this.speed);
        //this.mesh.position.z += this.direction[2] * (elapsed / 1000.0 * this.speed);
    }
}

module.exports = Sphere;

},{}]},{},[1]);

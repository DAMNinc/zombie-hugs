'use strict';

var camera, scene, renderer,
    gameState = null,
    clock = null,
    animationId = null,
    animating = false,
    Player = require('./player'),
    Fox = require('./fox'),
    Sphere = require('./sphere');

function updateGameState(elapsed) {
    if (gameState.player1 != null) {
        gameState.player1.update(elapsed);
    }

    if (gameState.player2 != null) {
        gameState.player2.update(elapsed);
    }

    for (var i = 0; i < gameState.zombies.length; i++) {
        gameState.zombies[i].update(elapsed);
    }
}

/**
 * Handle a resize of the viewport
 */
function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * Initializes the scene, renderer and game state.
 */
function init(renderAreaId) {
    // Init scene and camera.
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 100 / 100, 1, 10000);
    camera.position.z = 2000;

    // Init timetaking
    clock = new THREE.Clock(true);

    // Init gamestate
    gameState = {
        player1: null,
        player2: null,
        zombies: []
    };

    // Init renderer and add its DOM element to the given render area.
    renderer = new THREE.WebGLRenderer({ alpha: true });
    var renderArea = document.getElementById(renderAreaId);
    if (renderArea.hasChildNodes())
        renderArea.removeChild(renderArea.childNodes[0]);
    renderArea.appendChild(renderer.domElement);

    // Trigger a resize and set up a window event for resizing.
    handleResize();
    window.addEventListener('resize', handleResize);
}

/**
 * Animates everything.
 */
function animate() {
    if (animating) {
        // clock.getDelta returns the time in seconds since last call.
        var elapsed = clock.getDelta();
        updateGameState(elapsed);

        // Re-animate and render.
        animationId = requestAnimationFrame(animate);
        renderer.render(scene, camera);
    } 
}

function ZombieHugs() {
}

/**
 * Starts the game.
 */
ZombieHugs.prototype.start = function(renderArea) {
    // Cancel the previous animation loop.
    if (animationId !== null)
        cancelAnimationFrame(animationId);
    init(renderArea);
    animating = true;
    animate();
};

ZombieHugs.prototype.stop = function() {
    animating = false;
};

ZombieHugs.prototype.getGame = function() {
    return game;
};

/**
 * Tells the game that a player wants to join the current game. If the game
 * already has two players, it cannot be joined as a player.
 */
ZombieHugs.prototype.joinGame = function(playerID) {
    // Create a new player and give the player a reference to this game.
    // The player also controls the camera of the scene.
    // TODO, check if both players are already active.
    gameState.player1 = new Player(this, camera);
};

/**
 * Adds the given object to the scene.
 */
ZombieHugs.prototype.addZombie = function(zombie) {

    // Add the mesh of the zombie to the scene.
    scene.add(zombie.getMesh());

    // Save a reference to the zombie so it can be updated.
    gameState.zombies.push(zombie);
};

window.ZombieHugs = new ZombieHugs();

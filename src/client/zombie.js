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
    Fox = require('./fox');
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

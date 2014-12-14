(function() {
    var camera, scene, renderer,
        spheres = [], planes = {}, player = null,
        windowWidth = window.innerWidth-100,
        windowHeight = window.innerHeight-100,
        windowDepth = 1000,
        maxwidth = windowWidth/2,
        maxheight = windowHeight/2,
        maxdepth = windowDepth/2,
        sphereRadius = 30,
        planeStartTime = 400,
        planeStartOpacity = 0.4,
        animating = false;

    var planeLocation = {
        LEFT: 0,
        RIGHT: 1,
        TOP: 2,
        BOTTOM: 3,
        BACK: 4
    };
    
    function Plane(mesh) {
        this.mesh = mesh;
        this.timeleft = planeStartTime;
    
        this.reset = function () {
            this.timeleft = planeStartTime;
            this.mesh.material.opacity = planeStartOpacity;
        }
    
        this.updateMesh = function( elapsed ) {
            // First check if there is still time left in the animation
            if (this.timeleft > 0)
                this.timeleft -= elapsed;
            
            // After potential subtraction of the elapsed time, check again
            if (this.timeleft > 0) {
                // Opacity is a linear function of the time that is left of the animation
                // opacity = originalOpacity * timeleft / starttime
                this.mesh.material.opacity = planeStartOpacity + (1.0 - planeStartOpacity) * (this.timeleft / planeStartTime);
            }
            else {
                this.mesh.material.opacity = planeStartOpacity;
            }
        }
    }
    
    function Sphere(mesh) {
        this.mesh = mesh;
        this.direction = [ 
            Math.round(Math.random()) == 1 ? 1 : -1, 
            Math.round(Math.random()) == 1 ? 1 : -1,
            Math.round(Math.random()) == 1 ? 1 : -1
        ];
    
        // Speed will be between 400 and 600 pixels per millisecond.
        this.speed = Math.random() * 200 + 400;
    
        this.updatePosition = function (elapsed) {
            this.mesh.position.x += this.direction[0] * (elapsed / 1000.0 * this.speed);
            this.mesh.position.y += this.direction[1] * (elapsed / 1000.0 * this.speed);
            this.mesh.position.z += this.direction[2] * (elapsed / 1000.0 * this.speed);
        }
    
        this.updateCollision = function() {
            if (this.mesh.position.x >= (maxwidth-sphereRadius)) {
                hitPlane(planeLocation.RIGHT);
                this.direction[0] = -1;
            }
            else if (this.mesh.position.x <= -(maxwidth-sphereRadius)) {
                hitPlane(planeLocation.LEFT);
                this.direction[0] = 1;
            }
    
            if (this.mesh.position.y >= (maxheight-sphereRadius)) {
                hitPlane(planeLocation.TOP);
                this.direction[1] = -1;
            }
            else if (this.mesh.position.y <= -(maxheight-sphereRadius)) {
                hitPlane(planeLocation.BOTTOM);
                this.direction[1] = 1;
            }
    
            if (this.mesh.position.z >= maxdepth) {
                this.direction[2] = -1;
            }
            else if (this.mesh.position.z <= -maxdepth) {
                hitPlane(planeLocation.BACK);
                this.direction[2] = 1;
            }
        }
    }

    function Player() {
        this.forward = false;
        this.backward = false;
        this.left = false;
        this.right = false;

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
            var curPosX = camera.position.x;
            var curPosZ = camera.position.z;
            var curRot = camera.rotation.y;

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

            camera.rotation.y = curRot;
            camera.position.x = curPosX;
            camera.position.z = curPosZ;
        }

        // Register the player for key events.
        var closure = this;
        var startMoveEvent = function(keyEvent) {
            console.log('Key down ' + keyEvent.keyCode);
            closure.toggleMovement(keyEvent.keyCode, true);
        }

        var endMoveEvent = function(keyEvent) {
            console.log('Key up ' + keyEvent.keyCode);
            closure.toggleMovement(keyEvent.keyCode, false);
        }

        document.addEventListener('keydown', startMoveEvent);
        document.addEventListener('keyup', endMoveEvent);
    }
    
    function init() {
    
        scene = new THREE.Scene();
    
        camera = new THREE.PerspectiveCamera( 45, windowWidth / windowHeight, 1, 10000 );
        camera.position.z = 2000;
    
        var pointLight = new THREE.PointLight(0xffffff);
        pointLight.position.x = maxwidth - 50;
        pointLight.position.y = maxheight - 50;
        pointLight.position.z = maxdepth - 50;
        scene.add( pointLight );
    
        for (var i = 0; i < 1; i++) {
            var geometry = new THREE.SphereGeometry( sphereRadius, 10, 10);
            var material = new THREE.MeshLambertMaterial( { color: 0xff0000 } );
        
            spheres[i] = new Sphere ( new THREE.Mesh( geometry, material ) );
    
            scene.add( spheres[i].mesh );
        }
    
        initPlanes();
        player = new Player();
        
        renderer = new THREE.WebGLRenderer({ alpha: true });
        renderer.setSize( windowWidth, windowHeight );
    
        var renderarea = document.getElementById('render-area');
        if (renderarea.hasChildNodes())
            renderarea.removeChild(renderarea.childNodes[0]);
        renderarea.appendChild(renderer.domElement);
    
        lastTime = new Date();
    }
    
    function initPlanes() {
        initPlane(planeLocation.TOP);
        initPlane(planeLocation.BOTTOM);
        initPlane(planeLocation.RIGHT);
        initPlane(planeLocation.LEFT);
        initPlane(planeLocation.BACK);
    }

    function initPlane( planeLoc ) {
        var w, h, posx = 0, posy = 0, posz = 0, rotx = 0, roty = 0, rotz = 0;
    
        switch (planeLoc) {
            case planeLocation.BACK:
                w = windowWidth;
                h = windowHeight;
                posz = -maxdepth; 
                break;
            case planeLocation.LEFT:
                w = windowDepth;
                h = windowHeight;
                posx = -maxwidth;
                roty = Math.PI/2;
                break;
            case planeLocation.RIGHT:
                w = windowDepth;
                h = windowHeight;
                posx = maxwidth;
                roty = -Math.PI/2;
                break;
            case planeLocation.BOTTOM:
                w = windowWidth;
                h = windowDepth;
                posy = -maxheight;
                rotx = -Math.PI/2;
                break;
            case planeLocation.TOP:
                w = windowWidth;
                h = windowDepth;
                posy = maxheight;
                rotx = Math.PI/2;
                break;
        }
    
        geometry = new THREE.PlaneGeometry( w, h );
        material = new THREE.MeshLambertMaterial( { color: 0x0000ff, opacity: planeStartOpacity, transparent: true } );
        planeMesh = new THREE.Mesh( geometry, material );
        planeMesh.position.x = posx;
        planeMesh.position.y = posy;
        planeMesh.position.z = posz;
        planeMesh.rotation.x = rotx;
        planeMesh.rotation.y = roty;
        planeMesh.rotation.z = rotz;
    
        var thePlane = new Plane ( planeMesh );
        planes[planeLoc] = thePlane;
        
        scene.add( thePlane.mesh );
    }
    
    function hitPlane(planeLoc) {
        planes[planeLoc].reset();
        var wallsound = new Audio('content/lake.ogg');
        wallsound.play();
    }
    
    var lastTime = 0;
    
    function animate() {
        if (animating) {
            var now = new Date();
            var elapsed = now.getTime() - lastTime.getTime();
            lastTime = now;
    
            for (var i = 0; i < spheres.length; i++) {
                spheres[i].updateCollision();
                spheres[i].updatePosition(elapsed);
            }
    
            for (var i in planes) {
                planes[i].updateMesh(elapsed);
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
})();

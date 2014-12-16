(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

},{"./fox":2,"./player":3,"./sphere":4}],2:[function(require,module,exports){
/**
 * @author Mikael Emtinger
 * Apache license from ROME project.
 */


ROME = {};


// animal

ROME.Animal = function( geometry, parseMorphTargetsNames ) {

	var result = ROME.AnimalAnimationData.init( geometry, parseMorphTargetsNames );

	var that = {};
	that.morph = 0.0;
	that.animalA = { frames: undefined, currentFrame: 0, lengthInFrames: 0, currentTime: 0, lengthInMS: 0, timeScale: 1.0, name: "" };
	that.animalB = { frames: undefined, currentFrame: 0, lengthInFrames: 0, currentTime: 0, lengthInMS: 0, timeScale: 1.0, name: "" };
	that.availableAnimals = result.availableAnimals;
	that.mesh = new THREE.Mesh( geometry, result.material );

	var isPlaying = false;
	var morphTargetOrder = that.mesh.morphTargetForcedOrder;
	var material = result.material;

	
	//--- play ---

	that.play = function( animalA, animalB, morph, startTimeAnimalA, startTimeAnimalB ) {
		
		if( !isPlaying ) {

			isPlaying = true;
			that.morph = 0;

			THREE.AnimationHandler.addToUpdate( that );

		}
		
		animalB = animalB !== undefined ? animalB : animalA;
		morph = morph !== undefined ? morph : 0;
		
		setAnimalData( animalA, that.animalA );
		setAnimalData( animalB, that.animalB );
		
		that.animalA.currentTime = startTimeAnimalA ? startTimeAnimalA : 0;
		that.animalB.currentTime = startTimeAnimalB ? startTimeAnimalB : 0;
		
		that.update( 0 );

	};


	//--- update ---
	
	that.update = function( deltaTimeMS ) {
		
		if( that.mesh._modelViewMatrix ) {
			
			var data, dataNames = [ "animalA", "animalB" ];
			var d, dl;
			var f, fl;
			var frame, nextFrame;
			var time, nextTime;
			var unloopedTime;
			var lengthInMS;
			var lenghtInFrames;
			var morphTarget;
			var scale;
			
			for( d = 0, dl = dataNames.length, morphTarget = 0; d < dl; d++ ) {
				
				data = that[ dataNames[ d ] ];
				
				unloopedTime = data.currentTime;
				data.currentTime = ( data.currentTime + deltaTimeMS * data.timeScale ) % data.lengthInMS;
	
	
				// did we loop?
	
				if( unloopedTime > data.currentTime ) {
	
					data.currentFrame = 0;				
	
				}
	
	
				// find frame/nextFrame
				
	
				frame = 0;
				
				for( f = data.currentFrame, fl = data.lengthInFrames - 1; f < fl; f++ ) {
					
					if( data.currentTime >= data.frames[ f ].time && data.currentTime < data.frames[ f + 1 ].time ) {
						
						frame = f;
						break;
					}
				}
	
				data.currentFrame = frame;
				nextFrame = frame + 1 < fl ? frame + 1 : 0;
	

				morphTargetOrder[ morphTarget++ ] = data.frames[ frame     ].index;
				morphTargetOrder[ morphTarget++ ] = data.frames[ nextFrame ].index;

				
				time     = data.frames[ frame     ].time;
				nextTime = data.frames[ nextFrame ].time > time ? data.frames[ nextFrame ].time : data.frames[ nextFrame ].time + data.lengthInMS; 
				
				scale = ( data.currentTime - time ) / ( nextTime - time ) ;
				
				material.uniforms[ dataNames[ d ] + "Interpolation" ].value = scale;
	
			}
	
			material.uniforms.animalMorphValue.value = that.morph;
			
			if( material.attributes[ that.animalA.name ] !== undefined ) {
				
				material.attributes.colorAnimalA.buffer = material.attributes[ that.animalA.name ].buffer;
				
			}

			if( material.attributes[ that.animalB.name ] !== undefined ) {
				
				material.attributes.colorAnimalB.buffer = material.attributes[ that.animalB.name ].buffer;
				
			}
			
		}
		
	};


	//--- set new target animal ---
	
	that.setNewTargetAnimal = function( animal, startTimeAnimalB ) {
		
		if( that.morph === 1 ) {
			
			// switch so B -> A
			
			for( var property in that.animalA ) {
				
				that.animalA[ property ] = that.animalB[ property ];
				
			}
			
			
			// set new B and change morph
			
			that.animalB.currentTime = startTimeAnimalB ? startTimeAnimalB : 0;
			setAnimalData( animal, that.animalB );
			setFrame( that.animalB );
			that.morph = 0;
			
		} else {
			
			console.log( "Error: Cannot change animal target if morph != 1. Skipping." );

		}
		
	};


	//--- set animal data ---

	var setAnimalData = function( name, data ) {
		
		if( ROME.AnimalAnimationData[ name ] !== undefined ) {
			
			data.frames         = ROME.AnimalAnimationData[ name ];
			data.lengthInFrames = data.frames.length;
			data.lengthInMS     = data.frames[ data.lengthInFrames - 1 ].time;
			data.name           = name.toLowerCase();
			data.normalsOffset  = Math.floor( data.frames.length * 0.5, 10 );

		} else {
			
			console.log( "Error: Couldn't find data for animal " + name );
			
		}
		
	};
	
	
	//--- set frame ---
	
	var setFrame = function( data ) {
		
		var f, fl;
		var currentTime = data.currentTime;
		var frames = data.frames;
		
		for( f = 0, fl < frames.length; f < fl; f++ ) {
			
			if( currentTime >= frames[ f ].time ) {
				
				data.currentFrame = f;
				return;
				
			}
			
		}
		
	};


	//--- set current frame ---
	
	var setCurrentFrame = function( data ) {

	};

	
	//--- return public ---
	
	return that;

};



// shader

ROME.AnimalShader = {
	
	uniforms: function () {

		return THREE.UniformsUtils.merge( [ THREE.UniformsLib[ "common" ],
										    THREE.UniformsLib[ "lights" ], {
					"animalAInterpolation": 		{ type: "f", value: 0.0 },
					"animalBInterpolation": 		{ type: "f", value: 0.0 },
					"animalMorphValue" :    		{ type: "f", value: 0.0 },					

					"lightScale"  :    { type: "f", value: 1.0 },
					"lightOffset" :    { type: "v3", value: new THREE.Vector3( 0.0, 0.0, 0.0 ) }

			   } ] );
	},
	
	attributes: function() {
		
		return {
			
			"colorAnimalA": 	{ type: "c", boundTo: "faces", value: [] },
			"colorAnimalB": 	{ type: "c", boundTo: "faces", value: [] }
			
		}
		
	},

	vertexShader: [

		"uniform 	float	animalAInterpolation;",
		"uniform 	float	animalBInterpolation;",
		"uniform 	float	animalMorphValue;",

		"attribute	vec3	colorAnimalA;",
		"attribute	vec3	colorAnimalB;",

		"varying vec3 vColor;",
		"varying vec3 vLightWeighting;",
	
		THREE.ShaderChunk[ "lights_pars_vertex" ],

		"uniform float lightScale;",
		"uniform vec3 lightOffset;",

		"void main() {",
			
			"vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );",
			"vColor = mix( colorAnimalA, colorAnimalB, animalMorphValue );",

			"vec3 animalA = mix( morphTarget0, morphTarget1, animalAInterpolation );",
			"vec3 animalB = mix( morphTarget2, morphTarget3, animalBInterpolation );",
			"vec3 morphed = mix( animalA,      animalB,      animalMorphValue );",
			
			"vec3 transformedNormal = normalize( normalMatrix * normal );",

			//THREE.ShaderChunk[ "lights_vertex" ],
			
			// separate lights for animals
			// ( ambient + one directional )

			"vLightWeighting = vec3( 0.2 );",

			"vec4 lDirection = viewMatrix * vec4( vec3( 0.0, 1.0, 1.0 ), 0.0 );",
			"float directionalLightWeighting = dot( transformedNormal, normalize( lDirection.xyz ) ) * 0.5 + 0.5;",
			"vLightWeighting += vec3( 1.0 ) * directionalLightWeighting;",
			
			/*
			"vec4 lDirection = viewMatrix * vec4( vec3( 0.0, 1.0, 1.0 ), 0.0 );",
			"float directionalLightWeighting = max( dot( transformedNormal, normalize( lDirection.xyz ) ), 0.0 );",
			"vLightWeighting += vec3( 1.0 ) * directionalLightWeighting;",
			*/
			
			// tweak lighting
			
			//"vLightWeighting = lightScale * vLightWeighting + lightOffset;",

			"gl_Position = projectionMatrix * modelViewMatrix * vec4( morphed, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform vec3 diffuse;",
		"uniform float opacity;",
		
		THREE.ShaderChunk[ "fog_pars_fragment" ],
		THREE.ShaderChunk[ "lights_pars_fragment" ],

		"varying vec3 vLightWeighting;",
		"varying vec3 vColor;",

		"void main() {",

			//"gl_FragColor = vec4( 1.0 );",

			"gl_FragColor = vec4( vLightWeighting, 1.0 );",
			//"gl_FragColor = gl_FragColor * vec4( diffuse, opacity );",

			//"gl_FragColor = gl_FragColor * vec4( vColor, 1.0 );",
			
			"gl_FragColor = gl_FragColor * vec4( vColor, 1.0 ) * vec4( 0.9, 0.85, 0.8, 1.0 );",
			
			THREE.ShaderChunk[ "fog_fragment" ],
			
			//"gl_FragColor = gl_FragColor * vec4( 1.0, 0.0, 0.0, 1.0 );",

		"}"

	].join("\n")
}


// animation data

ROME.AnimalAnimationData = {

	animalNames: ["fox"],

	colorVariations: {
		
	"fox": { hRange:  0.03, sRange:   0.15, vRange:  0.25,
			 hOffset: -0.012, sOffset:  0.05, vOffset: 0.00 },
				  

	"zero": { hRange:  0.00, sRange:   0.00, vRange:  0.00,
			  hOffset: 0.00, sOffset:  0.00, vOffset: 0.00 }		  

	},
	
	animalVariationMap: { "fox" : "fox" },

	// init frame times and indices
	
	init: function( geometry, parseMorphTargetNames ) {
		
		if( !geometry.initialized ) {
			
			geometry.initialized = true;
			
			var availableAnimals = [];
			var animal, animalName;
			var charCode, morphTargetName, morphTarget, morphTargets = geometry.morphTargets;
			var a, al, m, ml, currentTime;
			
			// add animal names to static list?
			
			if( parseMorphTargetNames ) {
				
				for( m = 0, ml = morphTargets.length; m < ml; m++ ) {

					// check so not already exists
					
					for( a = 0, al = this.animalNames.length; a < al; a++ ) {
						
						animalName = this.animalNames[ a ];
						
						if( morphTargets[ m ].name.indexOf( animalName ) !== -1 ) {
							
							break;

						}
						
					}
					
					
					// did not exist?
					
					if( a === al ) {
						
						morphTargetName = morphTargets[ m ].name;
						
						for( a = 0; a < morphTargetName.length; a++ ) {
					
							charCode = morphTargetName.charCodeAt( a );
							
							if(! (( charCode >= 65 && charCode <= 90  ) ||
							      ( charCode >= 97 && charCode <= 122 ))) {
							      	
								break;      	
	
							} 
							
						}
						
						this.animalNames.push( morphTargetName.slice( 0, a ));
						
					}
					
				}
				
			}
					
			// parse out the names
			
			for( a = 0, al = this.animalNames.length; a < al; a++ ) {
				
				animalName  = this.animalNames[ a ];
				animal      = this[ animalName ];
				currentTime = 0;
				
				if( animal === undefined || animal.length === 0 ) {
					
					animal = this[ animalName ] = [];
					
					for( m = 0, ml = morphTargets.length; m < ml; m++ ) {
		
						if( morphTargets[ m ].name.indexOf( animalName ) !== -1 ) {
	
							animal.push( { index: m, time: currentTime } );
							currentTime += parseInt( 1000 / 24, 10 );		// 24 fps			
							
		
							if( availableAnimals.indexOf( animalName ) === -1 ) {
								
								availableAnimals.push( animalName );
								
							}
							
						}
						
					}
	
				} else {
					
					for( m = 0, ml = morphTargets.length; m < ml; m++ ) {
						
						if( availableAnimals.indexOf( animalName ) === -1 && morphTargets[ m ].name.indexOf( animalName ) !== -1 ) {
							
							availableAnimals.push( animalName );
							
						}
						
					}
					
				}
				 
			}
	
	
			// create material
	
			var material = new THREE.ShaderMaterial( {
				
				uniforms: ROME.AnimalShader.uniforms(),
				attributes: ROME.AnimalShader.attributes(),
				vertexShader: ROME.AnimalShader.vertexShader,
				fragmentShader: ROME.AnimalShader.fragmentShader,

				lights: true,
				morphTargets: true,
				vertexColors: THREE.VertexColors
				
			} );
			
	
			// set animal-specific light params

			//console.log( attributes.colorAnimalA.value );
			//console.log( availableAnimals );			

			// init custom attributes
			
			var c, cl, morphColor, morphColors = geometry.morphColors;
			var attributes = material.attributes;
			
			if( geometry.morphColors && geometry.morphColors.length ) {
				
				for( c = 0, cl = morphColors.length; c < cl; c++ ) {
					
					morphColor = morphColors[ c ];
					morphTargetName = morphColor.name;
					
					for( a = 0; a < morphTargetName.length; a++ ) {
				
						charCode = morphTargetName.charCodeAt( a );
						
						if(! (( charCode >= 65 && charCode <= 90  ) ||
						      ( charCode >= 97 && charCode <= 122 ))) {
						      	
							break;   

						} 

					}

					morphTargetName = morphTargetName.slice( 0, a ).toLowerCase();
					attributes[ morphTargetName ] = { type: "c", boundTo: "faces", value: morphColor.colors };
					
					// color variations per morph color

					var variations = this.colorVariations[ "zero" ];
					
					if ( this.animalVariationMap[ morphTargetName ] !== undefined ) {
						
						variations = this.colorVariations[  this.animalVariationMap[ morphTargetName ] ];
						//console.log( morphColor.name, morphTargetName );

					}
					
					if ( variations.lScale ) {
					
						material.uniforms.lightScale.value = variations.lScale;
						
					} else {
						
						material.uniforms.lightScale.value = 0.5;

					}

					if ( variations.lOffset ) {
					
						material.uniforms.lightOffset.value.set( variations.lOffset[ 0 ], variations.lOffset[ 1 ], variations.lOffset[ 2 ] );
						
					} else {
						
						material.uniforms.lightOffset.value.set( 0.6, 0.6, 0.6 );

					}		
					
					//console.log( morphTargetName );

					randomizeColors( attributes[ morphTargetName ].value, variations );
					
				}
				
				attributes.colorAnimalA.value = morphColors[ 0 ].colors;
				attributes.colorAnimalB.value = morphColors[ 0 ].colors;
				
				
				// check so each animal has a morph color
		
				for( a = 0, al = availableAnimals.length; a < al; a++ ) {
					
					animalName = availableAnimals[ a ].toLowerCase();
						
					for( c = 0, cl = morphColors.length; c < cl; c++ ) {
						
						morphColor = morphColors[ c ].name.toLowerCase();
						
						if( morphColor.indexOf( animalName ) !== -1 ) {
							
							break;
							
						}
						
					}
					
					// didn't exist?
					
					if( c === cl ) {
						
						console.error( "Animal.constructor: Morph Color missing for animal " + animalName + ". Deploying backup plan." );

						attributes[ animalName ] = { type: "c", boundTo: "faces", value: [] };
						
						for( c = 0, cl = geometry.faces.length; c < cl; c++ ) {
							
							attributes[ animalName ].value.push( new THREE.Color( 0xff0000 ));

						}
						
					}

				}

			} else {
				
				console.error( "Animal.constructor: Morph Colors doesn't exist, deploying fallback!" );
				
				for( c = 0, cl = geometry.faces.length; c < cl; c++ ) {
					
					attributes.colorAnimalA.value.push( new THREE.Color( 0xff00ff ) );
					
				}
				
				attributes.colorAnimalB.value = attributes.colorAnimalA.value;

				for( a = 0, al = availableAnimals; a < al; a++ ) {
					
					attributes[ availableAnimals[ a ] ] = { type: "c", boundTo: "faces", value: attributes.colorAnimalA.value };
					
				}
	
			}	

			//randomizeColors( attributes.colorAnimalA.value, variations );
			//randomizeColors( attributes.colorAnimalB.value, variations );

			
			// set return values
	
			geometry.availableAnimals = availableAnimals;
			geometry.customAttributes = material.attributes;

		} else {
			
			// create material
			
			var material = new THREE.ShaderMaterial( {
				
				uniforms: ROME.AnimalShader.uniforms(),
				attributes: {},
				vertexShader: ROME.AnimalShader.vertexShader,
				fragmentShader: ROME.AnimalShader.fragmentShader,
				
				fog: true,
				lights: true,
				morphTargets: true
				
			} );
			
			
			// copy custom attributes

			for( var a in geometry.customAttributes ) {

				var srcAttribute = geometry.customAttributes[ a ];
				
				if( a === "colorAnimalA" || a === "colorAnimalB" ) {
					
					material.attributes[ a ] = { 
						
						type: "c", 
						size: 3,
						boundTo: srcAttribute.boundTo, 
						value: srcAttribute.value, 
						array: undefined,
						buffer: undefined,
						needsUpdate: false,
						__webglInitialized: true

					};
					
				} else {
					
					material.attributes[ a ] = srcAttribute;
					
				}
				
			}
			
		}

		return {
			
			availableAnimals: geometry.availableAnimals,
			material: material
			
		};

	}

};

function randomizeColors( colors, variations ) {
	
	var i, il, c, hd, sd, vd;
	
	for( i = 0, il = colors.length; i < il; i++ ) {
		
		c = colors[ i ];

		hd = variations.hRange * Math.random() + variations.hOffset;
		sd = variations.sRange * Math.random() + variations.sOffset;
		vd = variations.vRange * Math.random() + variations.vOffset;

		//THREE.ColorUtils.adjustHSV( c, hd, sd, vd );
        //c.setHSL(hd, sd, vd);
		
	}

};

var loader = new THREE.JSONLoader(true);
var foxGeometry = null;
loader.load('/content/fox.json', function(geo) {
    console.log('Fox geometry loaded');
    foxGeometry = geo;
});

/**
 * Represents a fox.
 */
function Fox() {
    this.speed = 300;
    this.foxObj = new ROME.Animal(foxGeometry, true);
    this.foxObj.play(this.foxObj.availableAnimals[0], this.foxObj.availableAnimals[0]);
    this.foxObj.animalA.timeScale = this.foxObj.animalB.timeScale = 0.9;
};

Fox.prototype.update = function(elapsed) {
    this.foxObj.mesh.position.z -= elapsed * this.speed;
    this.foxObj.update(elapsed*1000);
};

Fox.prototype.getMesh = function() {
    return this.foxObj.mesh;
};

module.exports = Fox;

},{}],3:[function(require,module,exports){
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

},{"./fox":2}],4:[function(require,module,exports){
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

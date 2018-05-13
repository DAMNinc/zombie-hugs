(function() {
    var renderAreaId = "render-area",
        jsonloader = new THREE.JSONLoader(true),
        zombies = {},
        scene = null,
        zombie = null;
    
    function loadModel(name, path) {
        var $deferred = jQuery.Deferred();
        jsonloader.load(path, function(geo, mat) {
            var model = {
                geometry: geo,
                material: mat
            };
            zombies[name].model = model;
            $deferred.resolve(model);
        }, null, $deferred.reject);
        return $deferred.promise();
    }

   function setZombie(zombieName) {
       var newZombie = zombies[zombieName];

        function updatePreview() {
            if (zombie) {
                scene.remove(zombie.mesh);
            }
            zombie = new ROME.Animal(newZombie.model.geometry, true);
            zombie.mesh.scale.set(newZombie.previewScale, newZombie.previewScale, newZombie.previewScale);
            zombie.play(zombie.availableAnimals[0], zombie.availableAnimals[0]);
            zombie.animalA.timeScale = zombie.animalB.timeScale = 0.9;

            // Add the mesh of the zombie to the scene.
            scene.add(zombie.mesh);
        } 

        function updateZombieList() {
            $('a.zombie')
                .removeClass("active")
                .filter(`[data-zombie-name="${newZombie.name}"]`)
                .addClass("active");
        }

        function updateFeaturesList() {
            $('.zombie-features')
                .empty()
                .append(newZombie.features.reduce(function(features, feature) {
                    return features + `<li>${feature}</li>`;
                }, ""));
        }

        updatePreview();
        updateZombieList();
        updateFeaturesList();
   }

   function init() {

        function initPreview() {
            scene = new THREE.Scene();
            var camera = new THREE.PerspectiveCamera(45, 100 / 100, 1, 10000);

            var clock = new THREE.Clock(true);
            var renderer = new THREE.WebGLRenderer();
            document.getElementById(renderAreaId).appendChild( renderer.domElement );

            camera.position.y = 25;
            camera.position.z = 150;

            camera.aspect = renderer.domElement.clientWidth / renderer.domElement.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight);

            var render = function () {
                requestAnimationFrame( render );

                var elapsed = clock.getDelta();
                if (zombie) {
                    zombie.mesh.rotation.y += 0.01;
                    zombie.update(elapsed*1000); // TODO Get the fox running
                }
                
                renderer.render(scene, camera);
            };

            render();
        }

        function initZombies() {

            function initZombie(zombie) {
                zombies[zombie.name] = zombie;
                $(`<div class="list-group">
    <a href="#" class="list-group-item zombie" data-zombie-name="${zombie.name}">
        <h4 class="list-group-item-heading name">${zombie.name}</h4>
        <p class="list-group-item-text">${zombie.shortDescription}</p>
    </a>
</div>` )
                .appendTo('.zombie-list')
                .find('a.zombie')
                .on('click', function() {
                    setZombie(zombie.name);
                });

                return loadModel(zombie.name, zombie.modelPath);
            }

            return $.getJSON('/content/zombieinfo.json').then(function(data) {
                return $.when.apply(null, data.zombies.map(initZombie))
            });
        }

        initZombies()
            .then(function() {
                initPreview();
                setZombie(Object.getOwnPropertyNames(zombies)[0]);
            })
   }
   
   $(init);
})();
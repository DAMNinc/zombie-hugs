(function () {
    var renderAreaId = "render-area",
        jsonloader = new THREE.JSONLoader(true),
        zombies = {},
        scene = null,
        zombie = null;

    function loadModel(name, path) {
        var $deferred = jQuery.Deferred();
        jsonloader.load(path, function (geo, mat) {
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
            zombie.play(zombie.availableAnimals[0], zombie.availableAnimals[0]);
            zombie.animalA.timeScale = zombie.animalB.timeScale = 0.9;

            zombie.mesh.scale.set(newZombie.previewScale, newZombie.previewScale, newZombie.previewScale);
            zombie.mesh.position.x = newZombie.previewOffset.x;
            zombie.mesh.position.y = newZombie.previewOffset.y;
            zombie.mesh.position.z = newZombie.previewOffset.z;

            scene.add(zombie.mesh);
        }

        function updateZombieList() {
            $('a.zombie')
                .removeClass("active")
                .filter('[data-zombie-name="' + newZombie.name + '"]')
                .addClass("active");
        }

        function updateFeaturesList() {
            var color = newZombie.color || '#4caf50';
            $('.zombie-features')
                .empty()
                .append(newZombie.features.reduce(function (features, feature) {
                    return features +
                        '<li><span class="feature-dot" style="background:' + color + '"></span>' +
                        feature + '</li>';
                }, ""));
        }

        function updateDetails() {
            var nameEl = document.getElementById('detail-name');
            var taglineEl = document.getElementById('detail-tagline');
            if (nameEl) {
                nameEl.textContent = newZombie.name;
                nameEl.style.color = newZombie.color || '#333';
            }
            if (taglineEl) {
                taglineEl.textContent = newZombie.tagline || newZombie.shortDescription || '';
            }
        }

        updatePreview();
        updateZombieList();
        updateFeaturesList();
        updateDetails();
    }

    function init() {

        function initPreview() {
            scene = new THREE.Scene();
            scene.add(new THREE.AmbientLight(0x888888));
            var dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
            dirLight.position.set(0, 1, 1);
            scene.add(dirLight);

            var hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
            hemiLight.position.set(0, 200, 0);
            scene.add(hemiLight);

            var camera = new THREE.PerspectiveCamera(45, 100 / 100, 1, 10000);

            var clock = new THREE.Clock(true);
            var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
            renderer.setClearColor(0x111111, 1);

            var container = document.getElementById(renderAreaId);
            container.appendChild(renderer.domElement);

            function resize() {
                var w = container.clientWidth;
                var h = container.clientHeight;
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                renderer.setSize(w, h);
            }

            resize();
            window.addEventListener('resize', resize);

            var render = function () {
                requestAnimationFrame(render);

                var elapsed = clock.getDelta();
                if (zombie) {
                    zombie.mesh.rotation.y += 0.012;
                    zombie.update(elapsed * 1000);
                }

                renderer.render(scene, camera);
            };

            render();
        }

        function initZombies() {

            function initZombie(z) {
                zombies[z.name] = z;
                var color = z.color || '#4caf50';
                var key = z.key || '?';
                var html =
                    '<li>' +
                    '<a href="#" class="zombie" data-zombie-name="' + z.name + '">' +
                    '<span class="creature-key" style="background:' + color + '">' + key + '</span>' +
                    '<span class="creature-meta">' +
                    '<h4>' + z.name + '</h4>' +
                    '<p>' + z.shortDescription + '</p>' +
                    '</span>' +
                    '</a>' +
                    '</li>';

                $(html)
                    .appendTo('.zombie-list')
                    .find('a.zombie')
                    .on('click', function (e) {
                        e.preventDefault();
                        setZombie(z.name);
                    });

                return loadModel(z.name, z.modelPath);
            }

            return $.getJSON('/content/zombieinfo.json').then(function (data) {
                return $.when.apply(null, data.zombies.map(initZombie));
            });
        }

        function initKeyboard() {
            var names = Object.getOwnPropertyNames(zombies);
            window.addEventListener('keydown', function (e) {
                var index = -1;
                switch (e.keyCode) {
                    case 49: case 97:  index = 0; break; // 1
                    case 50: case 98:  index = 1; break; // 2
                    case 51: case 99:  index = 2; break; // 3
                    case 52: case 100: index = 3; break; // 4
                }
                if (index >= 0 && index < names.length) {
                    setZombie(names[index]);
                }
            });
        }

        initZombies()
            .then(function () {
                initPreview();
                setZombie(Object.getOwnPropertyNames(zombies)[0]);
                initKeyboard();
            });
    }

    $(init);
})();

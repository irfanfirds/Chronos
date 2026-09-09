import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_URL = '/models/f1_car_2026.glb';

// This GLB is already Y-up as exported (verified from its world bounds: 2.07 wide
// x 0.83 tall x 4.32 long, length along Z). An extra -90deg X correction tips the
// car onto its nose, so no rotation is applied.
const AXIS_CORRECTION = 0;

// Roughly matches the footprint of the old procedural car so the existing camera
// framing (position (3.5, 2.2, 4.0) looking at (0, 0.15, 0)) still reads correctly.
const TARGET_LENGTH = 4.2;

/**
 * Initializes the F1 car 3D telemetry scene, loading the real GLB chassis model.
 * @param {HTMLElement} container - DOM element container
 * @param {object} [callbacks]
 * @param {(loading: boolean) => void} [callbacks.onLoadingChange]
 * @param {(message: string) => void} [callbacks.onError]
 * @returns {object} Controller with cleanup, update, and camera-reset methods
 */
/**
 * The GLB's meshes are named generically (Body17, Body391...), so a click can't
 * be mapped to a part by name. Instead we classify by material + where the mesh
 * sits along the car's long axis, which is deterministic and matches what the
 * engineer sees. Tyres are the two "Rubber" meshes (front pair / rear pair -
 * the asset merges left and right, so there is no FL/FR split available).
 */
function classifyPart(mesh, modelBox) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const isRubber = mats.some((m) => m && m.name && m.name.toLowerCase().includes('rubber'));

  const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  const min = modelBox.min.z;
  const span = modelBox.max.z - min || 1;
  const t = (center.z - min) / span; // 0 = one end of the car, 1 = the other

  if (isRubber) return t < 0.5 ? 'REAR_TYRES' : 'FRONT_TYRES';
  if (t > 0.78) return 'FRONT_WING';
  if (t > 0.55) return 'FRONT_SUSPENSION';
  if (t > 0.32) return 'CHASSIS';
  if (t > 0.14) return 'POWER_UNIT';
  return 'REAR_WING';
}

export function initThreeCarSimulation(container, callbacks = {}) {
  if (!container) {
    return {
      destroy: () => {}, resetRotation: () => {}, updateWear: () => {},
      setSelectedPart: () => {},
    };
  }

  const { onLoadingChange, onError, onPartClick } = callbacks;
  let isDestroyed = false;

  const width = container.clientWidth || 480;
  const height = container.clientHeight || 280;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(3.5, 2.2, 4.0);
  camera.lookAt(0, 0.15, 0);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  // Lighting - keep the holographic telemetry-deck palette (acid green / cyan rim
  // lights) but add a neutral key + hemisphere fill so the real PBR chassis
  // materials (carbon fibre, satin steel) don't read as flat black.
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x0a0a0a, 0.6);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(4, 8, 5);
  scene.add(keyLight);

  const dirLight1 = new THREE.DirectionalLight(0xc8ff00, 1.4);
  dirLight1.position.set(6, 12, 8);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0x00f5d4, 1.2);
  dirLight2.position.set(-6, -4, -6);
  scene.add(dirLight2);

  const carGroup = new THREE.Group();
  scene.add(carGroup);

  // Holographic Projection Grid & Ground Target Rings (unchanged from the
  // original scene dressing)
  const grid = new THREE.GridHelper(6.5, 14, 0xc8ff00, 0x1f2b38);
  grid.position.y = 0.01;
  scene.add(grid);

  const haloRingGeo = new THREE.RingGeometry(1.8, 2.05, 36);
  const haloRingMat = new THREE.MeshBasicMaterial({
    color: 0x00f5d4,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.35,
    wireframe: true,
  });
  const groundHalo = new THREE.Mesh(haloRingGeo, haloRingMat);
  groundHalo.rotation.x = Math.PI / 2;
  groundHalo.position.y = 0.02;
  scene.add(groundHalo);

  // Populated once the model loads: the tyre material(s) we tint from live
  // wear telemetry. This GLB models both front tyres as one merged mesh and
  // both rear tyres as another - there is no independent FL/FR/RL/RR geometry
  // to color separately, so both ends of the car share one live value.
  let rubberMaterials = [];
  let latestWearPct = null;
  // Populated after load; used for raycast picking and selection highlighting.
  const pickableMeshes = [];
  let selectedPart = null;
  const baseRubberColor = new THREE.Color(0x1a1a1a);
  const okColor = new THREE.Color(0x2a2a2a);
  const warnColor = new THREE.Color(0x8a3500);
  const critColor = new THREE.Color(0xcc0033);

  function applyWearTint(pct) {
    if (!rubberMaterials.length || pct == null) return;
    let target = okColor;
    if (pct >= 85) target = critColor;
    else if (pct >= 60) target = warnColor;
    rubberMaterials.forEach((mat) => {
      mat.emissive.copy(target);
      mat.emissiveIntensity = pct >= 85 ? 0.9 : 0.5;
    });
  }

  // Framing is computed from the model's real box, not a bounding sphere: an F1
  // car is long and low, so a sphere fit wastes most of a wide panel and leaves
  // the car tiny. The car also spins on a turntable, so the horizontal extent we
  // must accommodate is its longest ground-plane axis.
  let framedRadius = null;
  let framedHeight = null;

  function fitCameraToModel(model) {
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    // The car sits on a turntable, so the safe fit is its bounding sphere - any
    // flat dimension would clip as it rotates through the diagonal.
    framedRadius = box.getBoundingSphere(new THREE.Sphere()).radius;
    framedHeight = size.y;
    applyCameraFraming();
  }

  function applyCameraFraming() {
    if (framedRadius == null) return;
    const vFov = (camera.fov * Math.PI) / 180;
    // Wide panels are constrained vertically; narrow ones horizontally.
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const limitingFov = Math.min(vFov, hFov);
    // 0.86 tightens the sphere fit: the sphere's vertical extent is mostly empty
    // air above/below a car this flat, so a strict fit leaves it looking tiny.
    const distance = (framedRadius / Math.sin(limitingFov / 2)) * 0.86;

    // Three-quarter view, slightly above the car, matching the original framing.
    const dir = new THREE.Vector3(0.62, 0.38, 0.69).normalize();
    camera.position.copy(dir.multiplyScalar(distance));
    camera.lookAt(0, framedHeight * 0.35, 0);
    camera.updateProjectionMatrix();
  }

  const loader = new GLTFLoader();
  if (onLoadingChange) onLoadingChange(true);

  loader.load(
    MODEL_URL,
    (gltf) => {
      if (isDestroyed) return;

      const model = gltf.scene;
      model.rotation.x = AXIS_CORRECTION;
      // Box3.setFromObject reads each child's matrixWorld, which is still the
      // pre-rotation matrix until the graph is refreshed - without this the
      // bounds (and every scale/centre/camera decision made from them) describe
      // the unrotated model, leaving the car mis-scaled and badly framed.
      model.updateWorldMatrix(true, true);

      // Normalize scale/position so the loaded chassis sits centered on the
      // grid at roughly the same footprint as the old placeholder car.
      let box = new THREE.Box3().setFromObject(model);
      let size = box.getSize(new THREE.Vector3());
      const longestAxis = Math.max(size.x, size.y, size.z) || 1;
      const scaleFactor = TARGET_LENGTH / longestAxis;
      model.scale.setScalar(scaleFactor);

      box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y; // rest on the grid plane (y = 0)

      // Real PBR materials need shadows/roughness to read correctly under the
      // stylized rig above; also collect the tyre ("Rubber") material(s) so
      // live wear data can tint them.
      const foundRubber = new Set();
      model.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = false;
        obj.receiveShadow = false;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => {
          if (!mat) return;
          if (mat.name && mat.name.toLowerCase().includes('rubber')) {
            foundRubber.add(mat);
          }
        });
      });
      rubberMaterials = Array.from(foundRubber);
      if (latestWearPct != null) applyWearTint(latestWearPct);

      // Tag every mesh with the part it belongs to, once, so click handling is
      // a lookup rather than a per-click geometry classification.
      const modelBox = new THREE.Box3().setFromObject(model);
      model.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.userData.chronosPart = classifyPart(obj, modelBox);
        pickableMeshes.push(obj);
      });

      carGroup.add(model);
      // Frame the camera from the model's actual bounds rather than a fixed
      // position: this component is rendered in panels of very different widths
      // (narrow overview column vs. wide car page), and a hardcoded camera clips
      // the car in the wider one.
      fitCameraToModel(model);
      if (onLoadingChange) onLoadingChange(false);
    },
    undefined,
    (err) => {
      if (isDestroyed) return;
      if (onLoadingChange) onLoadingChange(false);
      if (onError) onError(err && err.message ? err.message : 'Failed to load chassis model');
    }
  );

  // Interactive Drag & Rotation
  let isDragging = false;
  let previousMouseX = 0;
  let userRotationOffset = 0;

  const onPointerDown = (e) => {
    isDragging = true;
    previousMouseX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const currentX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const deltaX = currentX - previousMouseX;
    userRotationOffset += deltaX * 0.01;
    previousMouseX = currentX;
  };

  const onPointerUp = () => {
    isDragging = false;
  };

  // Click-to-select a car part. A drag also ends in a mouseup, so only treat it
  // as a pick when the pointer barely moved.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downX = 0;
  let downY = 0;

  const recordDown = (e) => {
    downX = e.clientX ?? 0;
    downY = e.clientY ?? 0;
  };

  const onCanvasClick = (e) => {
    if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
    if (!pickableMeshes.length || !onPartClick) return;

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hit = raycaster.intersectObjects(pickableMeshes, false)[0];
    if (hit?.object?.userData?.chronosPart) {
      onPartClick(hit.object.userData.chronosPart);
    }
  };

  function applySelectionHighlight() {
    pickableMeshes.forEach((mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isSelected = selectedPart && mesh.userData.chronosPart === selectedPart;
      mats.forEach((mat) => {
        if (!mat || !mat.emissive) return;
        // Never fight the wear tint - tyres own their emissive colour.
        if (rubberMaterials.includes(mat)) return;
        if (isSelected) {
          if (mat.userData.chronosBaseEmissive === undefined) {
            mat.userData.chronosBaseEmissive = mat.emissive.getHex();
          }
          mat.emissive.setHex(0x00f5d4);
          mat.emissiveIntensity = 0.55;
        } else if (mat.userData.chronosBaseEmissive !== undefined) {
          mat.emissive.setHex(mat.userData.chronosBaseEmissive);
          mat.emissiveIntensity = 0;
        }
      });
    });
  }

  const canvasEl = renderer.domElement;
  canvasEl.style.cursor = 'grab';
  canvasEl.addEventListener('mousedown', onPointerDown);
  canvasEl.addEventListener('mousedown', recordDown);
  canvasEl.addEventListener('click', onCanvasClick);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  canvasEl.addEventListener('touchstart', onPointerDown, { passive: true });
  window.addEventListener('touchmove', onPointerMove, { passive: true });
  window.addEventListener('touchend', onPointerUp);

  // Animation Loop
  const clock = new THREE.Clock();
  let animationFrameId = null;

  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();

    // Turntable smooth rotation + user drag offset
    carGroup.rotation.y = elapsed * 0.36 + userRotationOffset;
    groundHalo.rotation.z = -elapsed * 0.25;

    // Aerodynamic suspension vibration
    carGroup.position.y = Math.sin(elapsed * 2.2) * 0.03;

    // Warning strobe when wear is past the cliff threshold
    if (latestWearPct != null && latestWearPct >= 85 && rubberMaterials.length) {
      const pulseFast = (Math.sin(elapsed * 5.5) + 1.0) * 0.5;
      rubberMaterials.forEach((mat) => {
        mat.emissiveIntensity = 0.6 + pulseFast * 0.8;
      });
    }

    renderer.render(scene, camera);
  }

  animate();

  const handleResize = () => {
    if (!container) return;
    const newW = container.clientWidth || 480;
    const newH = container.clientHeight || 280;
    camera.aspect = newW / newH;
    renderer.setSize(newW, newH);
    // Re-frame on resize too - the same scene is mounted in panels of very
    // different shapes, and a window-only listener misses layout-driven changes.
    applyCameraFraming();
    camera.updateProjectionMatrix();
  };

  window.addEventListener('resize', handleResize);
  // Container can change size without the window doing so (page navigation,
  // flex/grid reflow), which is what left the car clipped on the wider page.
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
  resizeObserver?.observe(container);

  return {
    destroy: () => {
      isDestroyed = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      canvasEl.removeEventListener('mousedown', onPointerDown);
      canvasEl.removeEventListener('mousedown', recordDown);
      canvasEl.removeEventListener('click', onCanvasClick);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      canvasEl.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);

      // Clean up Three.js objects
      scene.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry?.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((mat) => mat && mat.dispose());
        }
      });
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
    resetRotation: () => {
      userRotationOffset = 0;
    },
    updateWear: (pct) => {
      latestWearPct = pct;
      applyWearTint(pct);
    },
    setSelectedPart: (part) => {
      selectedPart = part;
      applySelectionHighlight();
    },
  };
}

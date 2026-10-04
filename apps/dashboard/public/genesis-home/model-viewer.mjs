import * as T from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

export function createViewer(host, fallback, status, buttons, agents) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.setAttribute('role', 'img');
  host.append(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(36, 1, 0.1, 100);
  scene.add(new T.HemisphereLight('#ecf7ff', '#425852', 2));
  const key = new T.DirectionalLight('#fff5df', 3);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new T.DirectionalLight('#a6f1d1', 3);
  rim.position.set(-3, 3, -2);
  scene.add(rim);
  const fill = new T.DirectionalLight('#cceaff', 1.5);
  fill.position.set(-3, 1, 4);
  scene.add(fill);
  const target = new T.Vector3();
  let model, angle = 0.5, distance = 5, generation = 0, loaded = false, dragging = false, previousX = 0;
  const loader = new GLTFLoader();
  function render() {
    camera.position.set(target.x + Math.sin(angle) * distance, target.y + distance * 0.22, target.z + Math.cos(angle) * distance);
    camera.lookAt(target);
    renderer.render(scene, camera);
  }
  function resize() {
    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    renderer.setSize(box.width, box.height);
    camera.aspect = box.width / box.height;
    camera.updateProjectionMatrix();
    render();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  function dispose(object) {
    object.traverse(node => {
      if (!node.isMesh) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
  }
  function enable(value) { loaded = value; buttons.forEach(button => { button.disabled = !value; }); }
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    generation++;
    enable(false);
    fallback.hidden = false;
    status.textContent = '3D display interrupted. Character preview shown.';
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    if (model) { enable(true); fallback.hidden = true; resize(); status.textContent = 'Drag to rotate, or use the buttons.'; }
  });
  renderer.domElement.addEventListener('pointerdown', event => {
    if (!loaded) return;
    dragging = true;
    previousX = event.clientX;
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', event => {
    if (!dragging || !loaded) return;
    angle -= (event.clientX - previousX) * 0.012;
    previousX = event.clientX;
    render();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) renderer.domElement.addEventListener(type, () => { dragging = false; });
  return {
    rotate(direction) { if (loaded) { angle += direction * 0.35; render(); } },
    async show(id) {
      const current = ++generation;
      enable(false);
      fallback.hidden = false;
      status.textContent = 'Loading 3D model…';
      renderer.domElement.setAttribute('aria-label', agents[id].name + ' interactive 3D model');
      if (model) { scene.remove(model); dispose(model); model = undefined; render(); }
      try {
        const gltf = await loader.loadAsync('/genesis-home/assets/' + id + '.glb');
        if (current !== generation) { dispose(gltf.scene); return; }
        model = gltf.scene;
        scene.add(model);
        const bounds = new T.Box3().setFromObject(model);
        bounds.getCenter(target);
        const size = bounds.getSize(new T.Vector3());
        distance = Math.max(size.y, size.x, size.z) * 2.25;
        angle = 0.5;
        rim.color.set(agents[id].color);
        resize();
        enable(true);
        fallback.hidden = true;
        status.textContent = 'Drag to rotate, or use the buttons.';
      } catch {
        if (current !== generation) return;
        status.textContent = '3D unavailable. Character preview shown.';
      }
    },
    dispose() { generation++; observer.disconnect(); if (model) dispose(model); renderer.dispose(); renderer.domElement.remove(); }
  };
}

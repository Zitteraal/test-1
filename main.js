// === Externe Bibliotheken (THREE.js und CANNON.js für 3D- und Physik-Simulation) ===
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FilmShader } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/shaders/FilmShader.js';
import { VignetteShader } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/shaders/VignetteShader.js';
import * as CANNON from 'https://cdnjs.cloudflare.com/ajax/libs/cannon.js/0.6.2/cannon.min.js';
import { gsap } from 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.9.1/gsap.min.js';
import markdownit from 'https://cdn.jsdelivr.net/npm/markdown-it@13.0.1/dist/markdown-it.min.js';

// === Globale Variablen für die 3D-Szene ===
let scene, camera, renderer, composer, clock;
let world;
let core, coreShell, coreRing;
let dataParticles = [];
let mouseX = 0, mouseY = 0;
let targetX = 0, targetY = 0;
const windowHalfX = window.innerWidth / 2;
const windowHalfY = window.innerHeight / 2;
let cinematicCameraActive = true;
let cinematicCameraTarget = new THREE.Vector3(0, 0, 0);

// === DOM-Elemente ===
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('progress-bar');
const loader = document.getElementById('loader');
const accessGranted = document.getElementById('access-granted');
const appContainer = document.getElementById('appContainer');
const messagesDiv = document.getElementById('messages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const md = new markdownit();

// === Initialisiere 3D-Szene, Beleuchtung und Effekte ===
function init() {
    // 1. Szene erstellen und Nebel hinzufügen
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a0a, 20, 100);

    // 2. Kamera und Renderer konfigurieren
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('mainCanvas') });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(new THREE.Color(0x0d0d0d));

    // 3. Post-Processing-Effekte hinzufügen (Reihenfolge ist wichtig!)
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0;
    bloomPass.strength = 1.2;
    bloomPass.radius = 0.5;

    // Shader für filmischen Glitch- und Rausch-Effekt
    const filmPass = new ShaderPass(FilmShader);
    filmPass.uniforms['nIntensity'].value = 0.5; 
    filmPass.uniforms['sIntensity'].value = 0.5;
    filmPass.uniforms['sCount'].value = 500;

    // Shader für Vignette
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms['darkness'].value = 1.0;
    vignettePass.uniforms['offset'].value = 0.8;

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(filmPass);
    composer.addPass(vignettePass);

    // 4. Beleuchtung hinzufügen
    const ambientLight = new THREE.AmbientLight(0x404040, 5);
    scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(0x00ff00, 10, 100, 2);
    pointLight1.position.set(10, 10, 10);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xff00ff, 10, 100, 2);
    pointLight2.position.set(-10, -10, -10);
    scene.add(pointLight2);

    // 5. Physikwelt (Cannon.js) erstellen
    world = new CANNON.World();
    world.gravity.set(0, 0, 0);
    clock = new THREE.Clock();

    // 6. Event-Listener für Interaktivität
    document.addEventListener('mousemove', onDocumentMouseMove, false);
    window.addEventListener('resize', onWindowResize, false);
}

// === Erstellt den komplexen, mehrschichtigen KI-Kern ===
function createCore() {
    const coreGroup = new THREE.Group();

    // Innerer, pulsierender Kern
    const innerCoreGeo = new THREE.DodecahedronGeometry(2, 0);
    const innerCoreMat = new THREE.MeshPhysicalMaterial({
        color: 0x00ff00,
        emissive: 0x00ff00,
        emissiveIntensity: 0.8,
        metalness: 0.8,
        roughness: 0.1
    });
    const innerCore = new THREE.Mesh(innerCoreGeo, innerCoreMat);
    coreGroup.add(innerCore);

    // Mittlere, geometrische Hülle (transparente Gitterstruktur)
    const shellGeo = new THREE.IcosahedronGeometry(4, 1);
    const shellMat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        wireframe: true,
        transparent: true,
        opacity: 0.2
    });
    coreShell = new THREE.Mesh(shellGeo, shellMat);
    coreGroup.add(coreShell);

    // Äußerer, rotierender Ring mit Vertices
    const ringGeo = new THREE.TorusGeometry(8, 0.1, 16, 100);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.5
    });
    coreRing = new THREE.Mesh(ringGeo, ringMat);
    coreRing.rotation.x = Math.PI / 2;
    coreGroup.add(coreRing);

    // Füge Partikel auf dem Ring hinzu
    const ringPointsGeo = new THREE.BufferGeometry().setFromPoints(ringGeo.attributes.position.array);
    const ringPointsMat = new THREE.PointsMaterial({
        color: 0x00ffff,
        size: 0.1,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.8
    });
    const ringPoints = new THREE.Points(ringPointsGeo, ringPointsMat);
    coreGroup.add(ringPoints);

    scene.add(coreGroup);
    return coreGroup;
}

// === Erzeugt einen Hintergrund mit physikalischen Nebelpartikeln ===
function createNebulaBackground() {
    const numNebulaParticles = 10000;
    const positions = new Float32Array(numNebulaParticles * 3);
    const colors = new Float32Array(numNebulaParticles * 3);

    const color1 = new THREE.Color(0x000033);
    const color2 = new THREE.Color(0x0000ff);
    const color3 = new THREE.Color(0x330066);

    for (let i = 0; i < numNebulaParticles; i++) {
        // Position
        positions[i * 3] = (Math.random() - 0.5) * 500;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 500;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 500;

        // Farbe
        const color = new THREE.Color();
        color.lerpColors(color1, color2, Math.random());
        color.lerp(color3, Math.random());
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 1,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.5
    });

    const nebula = new THREE.Points(geometry, material);
    scene.add(nebula);
}

// === Event-Handler für Maus und Fenstergröße ===
function onDocumentMouseMove(event) {
    mouseX = (event.clientX - windowHalfX) * 0.5;
    mouseY = (event.clientY - windowHalfY) * 0.5;
}

function onWindowResize() {
    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight;
    renderer.setSize(newWidth, newHeight);
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    composer.setSize(newWidth, newHeight);
}

// === Haupt-Animations-Schleife ===
function animate() {
    requestAnimationFrame(animate);

    // Update der Physikwelt
    const dt = clock.getDelta();
    world.step(1 / 60, dt);

    // Aktualisiere 3D-Objekte aus der Physik-Engine
    for (let i = 0; i < dataParticles.length; i++) {
        dataParticles[i].mesh.position.copy(dataParticles[i].body.position);
        dataParticles[i].mesh.quaternion.copy(dataParticles[i].body.quaternion);
    }

    // Regelmäßige "Impulse" des KI-Kerns
    const time = performance.now() * 0.001;
    const impulseStrength = 50 * (Math.sin(time * 2) + 1.5);
    for (let particle of dataParticles) {
        const force = new CANNON.Vec3().copy(core.position);
        force.vsub(particle.body.position, force);
        force.normalize();
        force.scale(impulseStrength, force);
        particle.body.applyForce(force, particle.body.position);
    }

    // Kamera-Bewegung
    if (cinematicCameraActive) {
        const cinematicTime = performance.now() * 0.0001;
        const radius = 20 + Math.sin(cinematicTime * 0.5) * 5;
        camera.position.x = Math.sin(cinematicTime * 0.7) * radius;
        camera.position.z = Math.cos(cinematicTime * 0.7) * radius;
        camera.position.y = Math.sin(cinematicTime * 0.5) * 2;
        camera.lookAt(cinematicCameraTarget);
    } else {
        // Manuelle Kamerasteuerung mit Maus
        targetX = mouseX * 0.001;
        targetY = mouseY * 0.001;
        camera.rotation.y += 0.05 * (targetX - camera.rotation.y);
        camera.rotation.x += 0.05 * (targetY - camera.rotation.x);
    }

    // Kern-Animationen
    if (core) {
        core.rotation.y += 0.005;
        core.rotation.x += 0.002;
        if (coreShell) coreShell.rotation.y -= 0.008;
        if (coreRing) coreRing.rotation.y -= 0.01;
    }

    // Rendere die Szene mit dem Post-Processing-Composer
    composer.render();
}

// === Boot-Sequenz in detaillierten Phasen unterteilt ===
async function runBootSequence() {
    createNebulaBackground();
    core = createCore();

    await startPhase1CoreAssembly();
    await startPhase2DataInflux();
    await startPhase3SystemCalibration();
    await startPhase4Finalization();
    await transitionToTerminal();
}

// Phase 1: Aufbau des Kerns
async function startPhase1CoreAssembly() {
    statusText.textContent = "Initialisiere galaktische KI-Kern-Module...";
    gsap.to(statusText, { opacity: 1, duration: 1, repeat: -1, yoyo: true });
    gsap.to(progressBar, { width: '15%', duration: 4, ease: 'power2.out' });

    // Animiere Ring und Kern-Teile, um den Aufbau zu simulieren
    gsap.fromTo(core.scale, { x: 0.1, y: 0.1, z: 0.1 }, { x: 1, y: 1, z: 1, duration: 2, ease: "back.out(1.7)" });
    gsap.fromTo(coreRing.scale, { x: 0.1, y: 0.1, z: 0.1 }, { x: 1, y: 1, z: 1, duration: 2, ease: "back.out(1.7)", delay: 1 });

    gsap.to(progressBar, { width: '40%', duration: 4, ease: 'power2.out' });
    await new Promise(resolve => setTimeout(resolve, 4000));
}

// Phase 2: Massiver Datenstrom mit Physik
async function startPhase2DataInflux() {
    gsap.killTweensOf(statusText);
    statusText.textContent = "Lade 536 Terabyte an Datenprotokollen...";
    gsap.to(statusText, { opacity: 1, duration: 1, repeat: -1, yoyo: true });

    const numParticles = 2000;
    const particleGeometries = [
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.SphereGeometry(0.15, 8, 8),
        new THREE.TorusGeometry(0.1, 0.05, 8, 8)
    ];

    const particleMaterials = [
        new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
        new THREE.MeshBasicMaterial({ color: 0x00ffff }),
        new THREE.MeshBasicMaterial({ color: 0xff00ff })
    ];

    for (let i = 0; i < numParticles; i++) {
        const geometry = particleGeometries[Math.floor(Math.random() * particleGeometries.length)];
        const material = particleMaterials[Math.floor(Math.random() * particleMaterials.length)].clone();
        material.transparent = true;
        material.opacity = 0;

        const mesh = new THREE.Mesh(geometry, material);

        const shape = new CANNON.Sphere(0.15);
        const body = new CANNON.Body({ mass: 0.1 });
        body.addShape(shape);

        const radius = 50;
        const angle = Math.random() * Math.PI * 2;
        const zPos = (Math.random() - 0.5) * radius * 2;
        body.position.set(radius * Math.cos(angle), (Math.random() - 0.5) * 5, radius * Math.sin(angle) + zPos);

        world.addBody(body);
        scene.add(mesh);
        dataParticles.push({ mesh, body });

        gsap.to(mesh.material, { opacity: 1, duration: 1, delay: i * 0.002 });
    }

    gsap.to(progressBar, { width: '80%', duration: 8, ease: 'power2.out' });
    await new Promise(resolve => setTimeout(resolve, 8000));
}

// Phase 3: System-Kalibrierung und Kern-Aktivierung
async function startPhase3SystemCalibration() {
    gsap.killTweensOf(statusText);
    statusText.textContent = "Führe neuronale Kalibrierung durch...";
    gsap.to(statusText, { opacity: 1, duration: 1, repeat: -1, yoyo: true });

    gsap.to(core.scale, {
        x: 1.2, y: 1.2, z: 1.2,
        duration: 1,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut"
    });

    gsap.to(filmPass.uniforms['nIntensity'], { value: 0.1, duration: 2 });
    gsap.to(filmPass.uniforms['sIntensity'], { value: 0.1, duration: 2 });
    gsap.to(vignettePass.uniforms['darkness'], { value: 0.8, duration: 2 });

    const fadeDuration = 3;
    dataParticles.forEach(particle => {
        gsap.to(particle.mesh.material, { opacity: 0, transparent: true, duration: fadeDuration });
        setTimeout(() => {
            world.remove(particle.body);
            scene.remove(particle.mesh);
        }, fadeDuration * 1000);
    });

    gsap.to(progressBar, { width: '100%', duration: 5, ease: 'power2.out' });
    await new Promise(resolve => setTimeout(resolve, 5000));
}

// Phase 4: Finalisierung der Boot-Sequenz
async function startPhase4Finalization() {
    gsap.killTweensOf(core.scale);
    gsap.killTweensOf(statusText);
    gsap.to(core.scale, { x: 1, y: 1, z: 1, duration: 1 });

    gsap.to(camera.position, {
        x: 0, y: 5, z: 15,
        duration: 2,
        ease: "power2.inOut",
        onComplete: () => {
            cinematicCameraActive = false;
        }
    });

    gsap.to(accessGranted, { opacity: 1, scale: 1.1, duration: 1, ease: 'power2.out' });
    accessGranted.style.display = 'block';

    await new Promise(resolve => setTimeout(resolve, 3000));
}

// Übergang zur Chat-Anwendung
async function transitionToTerminal() {
    gsap.to(loader, { opacity: 0, duration: 1, onComplete: () => {
        document.body.classList.add('loaded');
        loader.style.display = 'none';
        userInput.focus();
    }});
}

window.onload = function () {
    init();
    animate();
    runBootSequence();
};

// ================================================================
// === Chat-Funktionen (unabhängig von der 3D-Simulation) ========
// ================================================================
const apiKey = "";
let chatHistory = [{
    role: 'model',
    parts: [{ text: "Willkommen, Benutzer. Geben Sie einen Befehl ein." }]
}];

function displayMessage(message, sender) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', sender === 'user' ? 'user-message' : 'bot-message');
    messageElement.innerHTML = md.render(message);
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function displayLoading() {
    const loadingElement = document.createElement('div');
    loadingElement.id = 'loadingSpinner';
    loadingElement.classList.add('message', 'bot-message', 'loading-spinner');
    loadingElement.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    messagesDiv.appendChild(loadingElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return loadingElement;
}

function hideLoading(spinnerElement, message) {
    spinnerElement.innerHTML = md.render(message);
    spinnerElement.classList.remove('loading-spinner');
    spinnerElement.id = '';
}

async function getGeminiResponse() {
    if (!apiKey) {
         throw new Error("API-Schlüssel fehlt. Bitte trage deinen Schlüssel in den Umgebungsvariablen ein.");
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const payload = {
        contents: chatHistory,
        tools: [{ "google_search": {} }],
        systemInstruction: {
            parts: [{ text: "Du bist ein KI-Assistent, der von Google entwickelt wurde. Du bist hilfreich, freundlich, sachkundig und sprichst Deutsch. Antworte in einem professionellen, aber dennoch lockeren und verständlichen Ton. Verwende Markdown für Hervorhebungen wie **fett** und *kursiv*. Verwende auch einfache Listen, um Informationen klar zu strukturieren. Um Code-Blöcke zu formatieren, verwende das Format ```[language] ... ```." }]
        }
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`API-Fehler: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text) {
            return text;
        } else {
            return "Entschuldigung, ich konnte keine Antwort generieren.";
        }

    } catch (error) {
        console.error("Fehler beim API-Aufruf:", error);
        return "Entschuldigung, es gab einen Fehler. Bitte versuche es später noch einmal.";
    }
}

async function sendMessage() {
    const message = userInput.value.trim();
    if (message === '') return;

    chatHistory.push({ role: 'user', parts: [{ text: message }] });

    userInput.disabled = true;
    sendBtn.disabled = true;

    displayMessage(message, 'user');
    userInput.value = '';
    const loadingSpinner = displayLoading();

    try {
        const botResponse = await getGeminiResponse();
        chatHistory.push({ role: 'model', parts: [{ text: botResponse }] });
        hideLoading(loadingSpinner, botResponse);
    } catch (error) {
        hideLoading(loadingSpinner, "Entschuldigung, es gab einen Fehler.");
    } finally {
        userInput.disabled = false;
        sendBtn.disabled = false;
        userInput.focus();
    }
}

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        sendMessage();
    }
});

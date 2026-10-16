import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// ==========================================
// Centralized Diagnostic & Debug Logger
// ==========================================
class Logger {
    constructor() {
        this.logs = [];
        this.errorCount = 0;
        this.container = document.getElementById('debugLogsContainer');
        this.badge = document.getElementById('debugErrorBadge');
    }

    add(level, tag, message, details = null) {
        const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
        const entry = { time, level, tag, message, details };
        this.logs.push(entry);

        if (level === 'ERROR') {
            this.errorCount++;
            if (this.badge) {
                this.badge.textContent = this.errorCount;
                this.badge.style.display = 'inline-block';
            }
            console.error(`[${tag}] ${message}`, details || '');
        } else if (level === 'WARN') {
            console.warn(`[${tag}] ${message}`, details || '');
        } else {
            console.log(`[${tag}] ${message}`, details || '');
        }

        this.renderRow(entry);
    }

    info(tag, msg) { this.add('INFO', tag, msg); }
    warn(tag, msg, details) { this.add('WARN', tag, msg, details); }
    error(tag, msg, details) { this.add('ERROR', tag, msg, details); }

    renderRow(entry) {
        if (!this.container) return;
        const emptyState = this.container.querySelector('.debug-empty');
        if (emptyState) emptyState.remove();

        const row = document.createElement('div');
        row.className = `log-row log-${entry.level.toLowerCase()}`;
        
        let detailsHtml = '';
        if (entry.details) {
            const errStr = typeof entry.details === 'object' ? (entry.details.stack || entry.details.message || JSON.stringify(entry.details)) : String(entry.details);
            detailsHtml = `<div style="color: #F87171; font-size: 0.72rem; margin-top: 2px;">${errStr}</div>`;
        }

        row.innerHTML = `
            <span class="log-time">[${entry.time}]</span>
            <span class="log-tag log-tag-${entry.level.toLowerCase()}">[${entry.tag}]</span>
            <div style="flex: 1;">
                <span class="log-msg">${entry.message}</span>
                ${detailsHtml}
            </div>
        `;

        this.container.appendChild(row);
        this.container.scrollTop = this.container.scrollHeight;
    }

    clear() {
        this.logs = [];
        this.errorCount = 0;
        if (this.badge) this.badge.style.display = 'none';
        if (this.container) {
            this.container.innerHTML = '<div class="debug-empty">Aguardando eventos...</div>';
        }
    }

    copy() {
        const text = this.logs.map(l => `[${l.time}] [${l.level}] [${l.tag}] ${l.message} ${l.details ? JSON.stringify(l.details) : ''}`).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            alert('Logs copiados para a área de transferência!');
        }).catch(err => {
            console.error('Falha ao copiar logs:', err);
        });
    }
}

const AppLogger = new Logger();

// Capturar erros globais de Javascript
window.onerror = (msg, url, lineNo, columnNo, error) => {
    AppLogger.error('SYSTEM', `${msg} (${url}:${lineNo})`, error);
    return false;
};

window.onunhandledrejection = (event) => {
    AppLogger.error('ASYNC', `Promise rejeitada: ${event.reason}`, event.reason);
};

// ==========================================
// Application State
// ==========================================
const state = {
    models: [],
    projects: [],
    foldersData: [],
    stats: null,
    viewMode: 'projects', // 'projects' | 'files'
    search: '',
    activeFolder: '',
    activeSubfolder: '',
    statusFilter: '',     // '' (todos) | 'project' | 'solid' | 'non_solid'
    isDuplicate: null,
    isFavorite: null,
    sortBy: 'name',
    sortOrder: 'asc',
    activeModel: null,
    activeProject: null,
    plateSubMode: '2d',   // '2d' (imagem) | '3d' (malha interativa da mesa)
    pollInterval: null
};

// ==========================================
// DOM Elements
// ==========================================
// Top Navigation & Scanner
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const scanBtn = document.getElementById('scanBtn');
const scanProgressBanner = document.getElementById('scanProgressBanner');
const scanProgressBar = document.getElementById('scanProgressBar');
const scanProgressPercent = document.getElementById('scanProgressPercent');
const scanCurrentFile = document.getElementById('scanCurrentFile');
const scanStatusTitle = document.getElementById('scanStatusTitle');

// Stats Elements
const statTotalModels = document.getElementById('statTotalModels');
const statSolid = document.getElementById('statSolid');
const statProjects = document.getElementById('statProjects');
const statNonSolid = document.getElementById('statNonSolid');
const statTotalSize = document.getElementById('statTotalSize');

// Folders & View Mode Toggle
const btnViewModeProjects = document.getElementById('btnViewModeProjects');
const btnViewModeFiles = document.getElementById('btnViewModeFiles');
const folderBreadcrumbBar = document.getElementById('folderBreadcrumbBar');
const breadcrumbTrail = document.getElementById('breadcrumbTrail');
const btnClearFolderFilter = document.getElementById('btnClearFolderFilter');
const foldersBar = document.getElementById('foldersBar');
const subfoldersPanel = document.getElementById('subfoldersPanel');
const subfoldersPanelTitle = document.getElementById('subfoldersPanelTitle');
const subfoldersCountBadge = document.getElementById('subfoldersCountBadge');
const subfolderSearchInput = document.getElementById('subfolderSearchInput');
const subfoldersBar = document.getElementById('subfoldersBar');
const countAllFolders = document.getElementById('countAllFolders');

const modalOpenBambuBtn = document.getElementById('modalOpenBambuBtn');
const projectOpenBambuBtn = document.getElementById('projectOpenBambuBtn');
const projectOpenFolderBtn = document.getElementById('projectOpenFolderBtn');
const btnProjectOpenBambuPart = document.getElementById('btnProjectOpenBambuPart');
const toastContainer = document.getElementById('toastContainer');

// Status Filter Pills & Toggles
const statusFilterPills = document.getElementById('statusFilterPills');
const countStatusAll = document.getElementById('countStatusAll');
const countStatusProjects = document.getElementById('countStatusProjects');
const countStatusSolid = document.getElementById('countStatusSolid');
const countStatusNonSolid = document.getElementById('countStatusNonSolid');
const chkFavorites = document.getElementById('chkFavorites');
const chkDuplicates = document.getElementById('chkDuplicates');
const sortBySelect = document.getElementById('sortBySelect');
const sortOrderBtn = document.getElementById('sortOrderBtn');
const orderIcon = document.getElementById('orderIcon');

// Grid
const modelsGrid = document.getElementById('modelsGrid');

// Single Model 3D Viewer Modal Elements
const viewerModal = document.getElementById('viewerModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalModelTitle = document.getElementById('modalModelTitle');
const modalBadges = document.getElementById('modalBadges');
const modalDownloadBtn = document.getElementById('modalDownloadBtn');
const canvasContainer = document.getElementById('canvasContainer');
const viewerLoader = document.getElementById('viewerLoader');
const btnToggleWireframe = document.getElementById('btnToggleWireframe');
const btnResetCamera = document.getElementById('btnResetCamera');

const overlayDim = document.getElementById('overlayDim');
const overlayTris = document.getElementById('overlayTris');
const overlayVolume = document.getElementById('overlayVolume');
const overlayWatertight = document.getElementById('overlayWatertight');

// Multi-Plate Viewer Elements
const modalModeSwitch = document.getElementById('modalModeSwitch');
const btnTabPlates = document.getElementById('btnTabPlates');
const btnTab3D = document.getElementById('btnTab3D');
const tabPlatesLabel = document.getElementById('tabPlatesLabel');
const tab3DLabel = document.getElementById('tab3DLabel');

const platesStripContainer = document.getElementById('platesStripContainer');
const platesStrip = document.getElementById('platesStrip');
const btnScrollPlatesLeft = document.getElementById('btnScrollPlatesLeft');
const btnScrollPlatesRight = document.getElementById('btnScrollPlatesRight');

const plateViewerContainer = document.getElementById('plateViewerContainer');
const btnPlateView2D = document.getElementById('btnPlateView2D');
const btnPlateView3D = document.getElementById('btnPlateView3D');
const plateFrame2D = document.getElementById('plateFrame2D');
const plateFrame3D = document.getElementById('plateFrame3D');
const plateMainImg = document.getElementById('plateMainImg');
const btnPrevPlate = document.getElementById('btnPrevPlate');
const btnNextPlate = document.getElementById('btnNextPlate');

const plate3DCanvasContainer = document.getElementById('plate3DCanvasContainer');
const plate3DLoader = document.getElementById('plate3DLoader');
const btnPlateWireframe = document.getElementById('btnPlateWireframe');
const btnPlateResetCam = document.getElementById('btnPlateResetCam');

const plateInfoCard = document.getElementById('plateInfoCard');
const plateCardTitle = document.getElementById('plateCardTitle');
const plateCardIndexTag = document.getElementById('plateCardIndexTag');
const plateMetricTime = document.getElementById('plateMetricTime');
const plateMetricWeight = document.getElementById('plateMetricWeight');
const plateMetricFilType = document.getElementById('plateMetricFilType');
const plateFilDot = document.getElementById('plateFilDot');
const plateMetricBed = document.getElementById('plateMetricBed');
const plateObjectsWrap = document.getElementById('plateObjectsWrap');
const plateObjectsList = document.getElementById('plateObjectsList');
const megaprojectNotice = document.getElementById('megaprojectNotice');

// Folder Project Modal Elements
const projectModal = document.getElementById('projectModal');
const projectModalCloseBtn = document.getElementById('projectModalCloseBtn');
const projectModalTitle = document.getElementById('projectModalTitle');
const projectPartsBadge = document.getElementById('projectPartsBadge');
const projectPathHint = document.getElementById('projectPathHint');
const projectPartsList = document.getElementById('projectPartsList');
const projectPartsCount = document.getElementById('projectPartsCount');
const projectActivePartName = document.getElementById('projectActivePartName');
const projectPartMetrics = document.getElementById('projectPartMetrics');
const projectCanvasContainer = document.getElementById('projectCanvasContainer');
const projectViewerLoader = document.getElementById('projectViewerLoader');
const btnProjectWireframe = document.getElementById('btnProjectWireframe');
const btnProjectResetCam = document.getElementById('btnProjectResetCam');
const btnDownloadActivePart = document.getElementById('btnDownloadActivePart');

// Debug Drawer Elements
const debugToggleBtn = document.getElementById('debugToggleBtn');
const debugDrawer = document.getElementById('debugDrawer');
const btnCloseDebug = document.getElementById('btnCloseDebug');
const btnClearLogs = document.getElementById('btnClearLogs');
const btnCopyLogs = document.getElementById('btnCopyLogs');

// State for multi-plate viewer
let currentPlatesData = null;
let activePlateIndex = 0;
let currentViewerMode = '3d'; // 'plates' | '3d'
let is3DLoadedForCurrentModel = false;
let currentPlate3DNum = null;

// Three.js instances
// 1. Main model viewer
let scene, camera, renderer, controls, currentObject, gridHelper;
let isWireframe = false;

// 2. Plate 3D interactive viewer
let plateScene, plateCamera, plateRenderer, plateControls, currentPlateObject, plateGridHelper;
let isPlateWireframe = false;

// 3. Project part 3D viewer
let projScene, projCamera, projRenderer, projControls, currentProjObject, projGridHelper;
let isProjWireframe = false;

// Concurrency load tokens
let activePlateLoadId = 0;
let activeMainLoadId = 0;
let activeProjLoadId = 0;

function clearPlateScene() {
    if (!plateScene) return;
    const toRemove = [];
    plateScene.children.forEach(child => {
        if (!child.isLight && child !== plateGridHelper) {
            toRemove.push(child);
        }
    });
    toRemove.forEach(c => {
        plateScene.remove(c);
        if (c.traverse) {
            c.traverse(node => {
                if (node.isMesh) {
                    if (node.geometry) node.geometry.dispose();
                    if (node.material) {
                        if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
                        else node.material.dispose();
                    }
                }
            });
        }
    });
    currentPlateObject = null;
    currentPlate3DNum = null;
}

function clearMainScene() {
    if (!scene) return;
    const toRemove = [];
    scene.children.forEach(child => {
        if (!child.isLight && child !== gridHelper) {
            toRemove.push(child);
        }
    });
    toRemove.forEach(c => {
        scene.remove(c);
        if (c.traverse) {
            c.traverse(node => {
                if (node.isMesh) {
                    if (node.geometry) node.geometry.dispose();
                    if (node.material) {
                        if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
                        else node.material.dispose();
                    }
                }
            });
        }
    });
    currentObject = null;
    is3DLoadedForCurrentModel = false;
}

function clearProjScene() {
    if (!projScene) return;
    const toRemove = [];
    projScene.children.forEach(child => {
        if (!child.isLight && child !== projGridHelper) {
            toRemove.push(child);
        }
    });
    toRemove.forEach(c => {
        projScene.remove(c);
        if (c.traverse) {
            c.traverse(node => {
                if (node.isMesh) {
                    if (node.geometry) node.geometry.dispose();
                    if (node.material) {
                        if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
                        else node.material.dispose();
                    }
                }
            });
        }
    });
    currentProjObject = null;
}

// ==========================================
// Status Badge Helper
// ==========================================
function getStatusBadge(item) {
    const isProj = item.mesh_status === 'project' || item.is_project || item.type === 'folder_project' || item.type === 'file_3mf_project';
    if (isProj) {
        return `<span class="badge badge-project">🚀 Projeto</span>`;
    }
    const isSolid = item.mesh_status === 'solid' || item.is_watertight === true;
    if (isSolid) {
        return `<span class="badge badge-solid">🛡️ Sólido</span>`;
    }
    return `<span class="badge badge-non-solid">⚠️ Não-Sólido</span>`;
}


// ==========================================
// Universal 3D Model Loader Helper
// ==========================================
function load3DFile(model) {
    const ext = (model.file_extension || '').toLowerCase();
    AppLogger.info('LOADER', `Iniciando carregamento de [${model.id}] ${model.filename} (${ext})...`);

    return new Promise((resolve, reject) => {
        if (ext === '.stl') {
            const loader = new STLLoader();
            loader.load(`/api/models/${model.id}/file`, (geometry) => {
                geometry.computeVertexNormals();
                geometry.center();
                const material = new THREE.MeshStandardMaterial({
                    color: 0x38BDF8,
                    roughness: 0.35,
                    metalness: 0.12
                });
                const mesh = new THREE.Mesh(geometry, material);
                resolve(mesh);
            }, undefined, (err) => reject(new Error(`Falha no STLLoader: ${err?.message || err}`)));
        } else if (ext === '.3mf') {
            if (model.file_size_mb > 35 || model.triangles_count > 1500000) {
                return reject(new Error(
                    `Este arquivo é um projeto multi-mesa (${model.file_size_mb} MB). Use as abas de mesas acima para inspecionar cada mesa individual em 3D.`
                ));
            }

            const loader = new GLTFLoader();
            loader.load(`/api/models/${model.id}/mesh.glb`, (gltf) => {
                const group = gltf.scene;
                const box = new THREE.Box3().setFromObject(group);
                const center = box.getCenter(new THREE.Vector3());
                group.position.sub(center);

                group.traverse((child) => {
                    if (child.isMesh) {
                        child.geometry.computeVertexNormals();
                        if (!child.material || child.material.color.getHex() === 0xffffff) {
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0x38BDF8,
                                roughness: 0.35,
                                metalness: 0.12
                            });
                        }
                    }
                });
                resolve(group);
            }, undefined, (err) => reject(new Error(`Falha ao carregar malha GLB do 3MF: ${err?.message || err}`)));
        } else if (ext === '.obj') {
            const loader = new OBJLoader();
            loader.load(`/api/models/${model.id}/file`, (group) => {
                const box = new THREE.Box3().setFromObject(group);
                const center = box.getCenter(new THREE.Vector3());
                group.position.sub(center);

                const material = new THREE.MeshStandardMaterial({
                    color: 0x38BDF8,
                    roughness: 0.35,
                    metalness: 0.12
                });

                group.traverse((child) => {
                    if (child.isMesh) {
                        child.geometry.computeVertexNormals();
                        child.material = material;
                    }
                });
                resolve(group);
            }, undefined, (err) => reject(new Error(`Falha no OBJLoader: ${err?.message || err}`)));
        } else {
            reject(new Error(`Formato de arquivo ${ext} não suportado para visualização 3D.`));
        }
    });
}


// ==========================================
// Offscreen 3D Thumbnail Generator
// ==========================================
class ThumbnailRenderer {
    constructor() {
        this.width = 400;
        this.height = 300;
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true
        });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setClearColor(0x000000, 0);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(40, this.width / this.height, 0.1, 1000);

        const ambient = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambient);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
        keyLight.position.set(100, 150, 100);
        this.scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x06B6D4, 0.8);
        fillLight.position.set(-100, 80, -80);
        this.scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0x818CF8, 0.6);
        rimLight.position.set(0, -100, -100);
        this.scene.add(rimLight);

        this.queue = [];
        this.isProcessing = false;
    }

    addToQueue(model, onGenerated, onError) {
        this.queue.push({ model, onGenerated, onError });
        this.processNext();
    }

    async processNext() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        const item = this.queue.shift();
        if (!item) {
            this.isProcessing = false;
            return;
        }

        const { model, onGenerated, onError } = item;

        try {
            AppLogger.info('THUMBNAIL', `Iniciando geração de thumbnail para [${model.id}] ${model.filename}...`);
            const dataUrl = await this.renderModel(model);
            if (dataUrl) {
                onGenerated(dataUrl);
                AppLogger.info('THUMBNAIL', `✓ Sucesso ao gerar thumbnail para ${model.filename}`);

                fetch(`/api/models/${model.id}/thumbnail`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image_base64: dataUrl })
                }).catch(e => AppLogger.warn('CACHE', `Falha ao salvar thumbnail de ${model.filename} no backend`, e));
            }
        } catch (err) {
            AppLogger.error('THUMBNAIL', `Erro gerando thumbnail para ${model.filename}`, err);
            if (onError) onError(err);
        } finally {
            this.isProcessing = false;
            setTimeout(() => this.processNext(), 40);
        }
    }

    async renderModel(model) {
        const object3d = await load3DFile(model);
        this.scene.add(object3d);

        const box = new THREE.Box3().setFromObject(object3d);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const radius = (sphere && sphere.radius > 0) ? sphere.radius : 30;

        this.camera.near = Math.max(0.01, radius / 500);
        this.camera.far = Math.max(1000, radius * 100);
        this.camera.updateProjectionMatrix();

        this.camera.position.set(radius * 1.5, radius * 1.3, radius * 1.8);
        this.camera.lookAt(0, 0, 0);

        this.renderer.render(this.scene, this.camera);
        const dataUrl = this.canvas.toDataURL('image/webp', 0.85);

        this.scene.remove(object3d);
        if (object3d.geometry) object3d.geometry.dispose();

        return dataUrl;
    }
}

const thumbnailRenderer = new ThumbnailRenderer();


// ==========================================
// Initialization & Event Listeners
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    AppLogger.info('INIT', 'STLManager iniciado. Inicializando Three.js e carregando acervo...');
    initThreeViewers();
    fetchStats();
    fetchFolders();
    refreshView();
    setupEventListeners();
    checkScanStatus();
});

function setupEventListeners() {
    // Search with debounce
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
        state.search = e.target.value.trim();
        clearSearchBtn.style.display = state.search ? 'block' : 'none';
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            refreshView();
        }, 300);
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        state.search = '';
        clearSearchBtn.style.display = 'none';
        refreshView();
    });

    // View Mode Toggle (Projects vs Files)
    btnViewModeProjects.addEventListener('click', () => {
        if (state.viewMode === 'projects') return;
        state.viewMode = 'projects';
        btnViewModeProjects.classList.add('active');
        btnViewModeFiles.classList.remove('active');
        refreshView();
    });

    btnViewModeFiles.addEventListener('click', () => {
        if (state.viewMode === 'files') return;
        state.viewMode = 'files';
        btnViewModeFiles.classList.add('active');
        btnViewModeProjects.classList.remove('active');
        refreshView();
    });

    // Triple Status Filter Pills
    statusFilterPills.querySelectorAll('.status-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            statusFilterPills.querySelectorAll('.status-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            state.statusFilter = pill.dataset.status || '';
            refreshView();
        });
    });

    // Scan Button
    scanBtn.addEventListener('click', async () => {
        try {
            scanBtn.disabled = true;
            showToast('Sincronização', 'Verificando alterações na biblioteca...', 'info', 2000);
            AppLogger.info('SCAN', 'Disparando varredura no servidor...');
            const res = await fetch('/api/scan/start', { method: 'POST' });
            const data = await res.json();
            AppLogger.info('SCAN', `Resposta do scanner: ${data.message}`);
            startPollingScan(true);
        } catch (err) {
            AppLogger.error('SCAN', 'Erro ao iniciar varredura', err);
            showToast('Erro', `Falha ao iniciar varredura: ${err.message}`, 'error', 4000);
        } finally {
            scanBtn.disabled = false;
        }
    });

    // Debug Drawer Toggle
    debugToggleBtn.addEventListener('click', () => {
        const isHidden = debugDrawer.style.display === 'none';
        debugDrawer.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
            updateCacheStatus();
        }
    });

    const btnClearCache = document.getElementById('btnClearCacheBtn');
    if (btnClearCache) {
        btnClearCache.addEventListener('click', async () => {
            try {
                btnClearCache.disabled = true;
                const res = await fetch('/api/cache/clear', { method: 'POST' });
                const data = await res.json();
                showToast('Cache 3D', `Cache liberado! ${data.freed_mb} MB removidos.`, 'success', 3000);
                updateCacheStatus();
            } catch (err) {
                showToast('Erro', `Falha ao limpar cache: ${err.message}`, 'error', 3000);
            } finally {
                btnClearCache.disabled = false;
            }
        });
    }

    btnCloseDebug.addEventListener('click', () => {
        debugDrawer.style.display = 'none';
    });

    btnClearLogs.addEventListener('click', () => {
        AppLogger.clear();
    });

    btnCopyLogs.addEventListener('click', () => {
        AppLogger.copy();
    });

    // Additional Filters
    chkDuplicates.addEventListener('change', (e) => {
        state.isDuplicate = e.target.checked ? true : null;
        refreshView();
    });

    chkFavorites.addEventListener('change', (e) => {
        state.isFavorite = e.target.checked ? true : null;
        refreshView();
    });

    // Sorting
    sortBySelect.addEventListener('change', (e) => {
        state.sortBy = e.target.value;
        refreshView();
    });

    sortOrderBtn.addEventListener('click', () => {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
        orderIcon.textContent = state.sortOrder === 'asc' ? '↑' : '↓';
        refreshView();
    });

    // Single Model Viewer Modal controls
    modalCloseBtn.addEventListener('click', closeModal);
    viewerModal.addEventListener('click', (e) => {
        if (e.target === viewerModal) closeModal();
    });

    // Folder Project Modal controls
    projectModalCloseBtn.addEventListener('click', closeProjectModal);
    projectModal.addEventListener('click', (e) => {
        if (e.target === projectModal) closeProjectModal();
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (viewerModal.style.display !== 'none') {
            if (e.key === 'Escape') {
                closeModal();
            } else if (currentViewerMode === 'plates' && currentPlatesData) {
                if (e.key === 'ArrowLeft') {
                    selectPlate(activePlateIndex - 1);
                } else if (e.key === 'ArrowRight') {
                    selectPlate(activePlateIndex + 1);
                }
            }
        } else if (projectModal.style.display !== 'none') {
            if (e.key === 'Escape') {
                closeProjectModal();
            }
        }
    });

    // Multi-Plate Viewer Controls
    btnTabPlates.addEventListener('click', () => switchViewerMode('plates'));
    btnTab3D.addEventListener('click', () => switchViewerMode('3d'));

    btnPrevPlate.addEventListener('click', () => selectPlate(activePlateIndex - 1));
    btnNextPlate.addEventListener('click', () => selectPlate(activePlateIndex + 1));

    btnScrollPlatesLeft.addEventListener('click', () => platesStrip.scrollBy({ left: -200, behavior: 'smooth' }));
    btnScrollPlatesRight.addEventListener('click', () => platesStrip.scrollBy({ left: 200, behavior: 'smooth' }));

    // Toggle 2D vs 3D inside Plate Viewer (User Request #1)
    btnPlateView2D.addEventListener('click', () => switchPlateSubMode('2d'));
    btnPlateView3D.addEventListener('click', () => switchPlateSubMode('3d'));

    btnPlateWireframe.addEventListener('click', () => {
        if (!currentPlateObject) return;
        isPlateWireframe = !isPlateWireframe;
        currentPlateObject.traverse((child) => {
            if (child.isMesh && child.material) child.material.wireframe = isPlateWireframe;
        });
        btnPlateWireframe.classList.toggle('active', isPlateWireframe);
    });

    btnPlateResetCam.addEventListener('click', resetPlateCamera);

    // Main 3D Viewport Controls
    btnToggleWireframe.addEventListener('click', () => {
        if (!currentObject) return;
        isWireframe = !isWireframe;
        currentObject.traverse((child) => {
            if (child.isMesh && child.material) child.material.wireframe = isWireframe;
        });
        btnToggleWireframe.classList.toggle('active', isWireframe);
        AppLogger.info('VIEWER', `Wireframe ${isWireframe ? 'ativado' : 'desativado'}`);
    });

    btnResetCamera.addEventListener('click', resetCamera);

    // Project Modal 3D Controls
    btnProjectWireframe.addEventListener('click', () => {
        if (!currentProjObject) return;
        isProjWireframe = !isProjWireframe;
        currentProjObject.traverse((child) => {
            if (child.isMesh && child.material) child.material.wireframe = isProjWireframe;
        });
        btnProjectWireframe.classList.toggle('active', isProjWireframe);
    });

    btnProjectResetCam.addEventListener('click', resetProjCamera);

    // Slicer & Windows Explorer Launch Handlers
    if (modalOpenBambuBtn) {
        modalOpenBambuBtn.addEventListener('click', () => {
            if (state.activeModel) {
                openInBambuStudio(state.activeModel.id, state.activeModel.filename);
            }
        });
    }

    if (projectOpenBambuBtn) {
        projectOpenBambuBtn.addEventListener('click', () => {
            if (state.activeProject) {
                openProjectInBambu(state.activeProject.id, state.activeProject.title);
            }
        });
    }

    if (projectOpenFolderBtn) {
        projectOpenFolderBtn.addEventListener('click', () => {
            if (state.activeProject && state.activeProject.parts && state.activeProject.parts.length > 0) {
                openModelFolder(state.activeProject.parts[0].id);
            }
        });
    }

    if (btnProjectOpenBambuPart) {
        btnProjectOpenBambuPart.addEventListener('click', () => {
            if (state.activeProjectPart) {
                openInBambuStudio(state.activeProjectPart.id, state.activeProjectPart.filename);
            }
        });
    }

    if (btnClearFolderFilter) {
        btnClearFolderFilter.addEventListener('click', () => {
            clearFolderFilter();
        });
    }
}


// ==========================================
// Central View Dispatcher
// ==========================================
function refreshView(isBackground = false) {
    if (state.viewMode === 'projects') {
        fetchProjects(isBackground);
    } else {
        fetchModels(isBackground);
    }
}


// ==========================================
// API Handlers (Stats, Folders, Models, Projects)
// ==========================================
async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        state.stats = data;

        // Counters Cards
        statTotalModels.textContent = data.total_models;
        statSolid.textContent = data.solid_count ?? data.watertight_count ?? 0;
        statProjects.textContent = data.project_count ?? 0;
        statNonSolid.textContent = data.non_solid_count ?? 0;
        statTotalSize.textContent = `${data.total_size_mb} MB em disco`;

        // Pill Counters
        countStatusAll.textContent = data.total_models;
        countStatusProjects.textContent = data.project_count ?? 0;
        countStatusSolid.textContent = data.solid_count ?? data.watertight_count ?? 0;
        countStatusNonSolid.textContent = data.non_solid_count ?? 0;

        if (countAllFolders) countAllFolders.textContent = data.total_models;
    } catch (err) {
        AppLogger.error('API', 'Erro ao obter estatísticas do servidor', err);
    }
}

async function fetchFolders() {
    try {
        const res = await fetch('/api/folders');
        const folders = await res.json();
        state.foldersData = folders;
        renderFoldersBar(folders);
    } catch (err) {
        AppLogger.error('API', 'Erro ao obter árvore de pastas', err);
    }
}

// ==========================================
// Toast Notifications & Slicer Handlers
// ==========================================
function showToast(title, message, type = 'info', duration = 4000) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icon = type === 'success' ? '🚀' : type === 'error' ? '⚠️' : 'ℹ️';
    
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <div class="toast-content">
            <span class="toast-title">${title}</span>
            <span class="toast-message">${message}</span>
        </div>
        <button class="toast-close">&times;</button>
    `;

    toast.querySelector('.toast-close').onclick = () => {
        toast.style.animation = 'toastFadeOut 0.2s forwards';
        setTimeout(() => toast.remove(), 200);
    };

    toastContainer.appendChild(toast);

    if (duration > 0) {
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.animation = 'toastFadeOut 0.25s forwards';
                setTimeout(() => toast.remove(), 250);
            }
        }, duration);
    }
}

async function openInBambuStudio(modelId, filename = '') {
    showToast('Bambu Studio', `Enviando "${filename || 'modelo'}" para o Bambu Studio...`, 'info', 3000);
    try {
        const res = await fetch(`/api/models/${modelId}/open?slicer=bambu`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Bambu Studio', data.message || 'Arquivo aberto com sucesso!', 'success', 4000);
        } else {
            showToast('Aviso do Fatiador', data.message || 'Não foi possível iniciar o Bambu Studio.', 'error', 6000);
        }
    } catch (err) {
        showToast('Erro ao Abrir', `Falha de comunicação: ${err.message}`, 'error', 5000);
    }
}

async function openProjectInBambu(projectId, title = '') {
    showToast('Bambu Studio', `Enviando projeto "${title || ''}" para o Bambu Studio...`, 'info', 3000);
    try {
        const res = await fetch('/api/projects/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: projectId, slicer: 'bambu' })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Bambu Studio', data.message || 'Projeto aberto com sucesso!', 'success', 4000);
        } else {
            showToast('Aviso do Fatiador', data.message || 'Não foi possível abrir o projeto.', 'error', 6000);
        }
    } catch (err) {
        showToast('Erro ao Abrir', `Falha de comunicação: ${err.message}`, 'error', 5000);
    }
}

async function openModelFolder(modelId) {
    try {
        const res = await fetch(`/api/models/${modelId}/open-folder`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Windows Explorer', data.message || 'Pasta aberta no Windows.', 'success', 3000);
        } else {
            showToast('Explorer', data.message || 'Não foi possível abrir a pasta.', 'error', 4000);
        }
    } catch (err) {
        showToast('Erro Explorer', err.message, 'error', 4000);
    }
}

// ==========================================
// Breadcrumb Navigation & Folder Management
// ==========================================
function renderBreadcrumbs() {
    if (!breadcrumbTrail) return;
    breadcrumbTrail.innerHTML = '';

    // Item 1: Início
    const rootBtn = document.createElement('button');
    rootBtn.className = `breadcrumb-item ${!state.activeFolder && !state.activeSubfolder ? 'active' : ''}`;
    rootBtn.innerHTML = `🏠 Início`;
    rootBtn.onclick = () => {
        clearFolderFilter();
    };
    breadcrumbTrail.appendChild(rootBtn);

    if (state.activeFolder) {
        const sep1 = document.createElement('span');
        sep1.className = 'breadcrumb-separator';
        sep1.textContent = '›';
        breadcrumbTrail.appendChild(sep1);

        const folderBtn = document.createElement('button');
        folderBtn.className = `breadcrumb-item ${!state.activeSubfolder ? 'active' : ''}`;
        folderBtn.innerHTML = `📁 ${state.activeFolder}`;
        folderBtn.onclick = () => {
            state.activeSubfolder = '';
            const rootObj = state.foldersData.find(f => f.path === state.activeFolder);
            if (rootObj && rootObj.subfolders && rootObj.subfolders.length > 0) {
                renderSubfoldersPanel(rootObj);
            }
            renderBreadcrumbs();
            refreshView();
        };
        breadcrumbTrail.appendChild(folderBtn);
    }

    if (state.activeSubfolder) {
        let subDisplayName = state.activeSubfolder;
        if (state.activeFolder && subDisplayName.startsWith(state.activeFolder)) {
            subDisplayName = subDisplayName.slice(state.activeFolder.length).replace(/^[/\\]+/, '');
        }

        const sep2 = document.createElement('span');
        sep2.className = 'breadcrumb-separator';
        sep2.textContent = '›';
        breadcrumbTrail.appendChild(sep2);

        const subBtn = document.createElement('button');
        subBtn.className = 'breadcrumb-item active';
        subBtn.innerHTML = `📂 ${subDisplayName}`;
        breadcrumbTrail.appendChild(subBtn);
    }

    if (btnClearFolderFilter) {
        if (state.activeFolder || state.activeSubfolder) {
            btnClearFolderFilter.style.display = 'inline-flex';
        } else {
            btnClearFolderFilter.style.display = 'none';
        }
    }
}

function clearFolderFilter() {
    state.activeFolder = '';
    state.activeSubfolder = '';
    foldersBar.querySelectorAll('.folder-chip').forEach(c => c.classList.remove('active'));
    const rootChip = foldersBar.querySelector('.folder-chip[data-folder=""]');
    if (rootChip) rootChip.classList.add('active');
    if (subfoldersPanel) subfoldersPanel.style.display = 'none';
    if (subfolderSearchInput) subfolderSearchInput.value = '';
    renderBreadcrumbs();
    refreshView();
}

function renderFoldersBar(folders) {
    const rootChip = foldersBar.querySelector('.folder-chip[data-folder=""]');
    foldersBar.innerHTML = '';
    foldersBar.appendChild(rootChip);

    rootChip.onclick = () => {
        clearFolderFilter();
    };

    folders.forEach(root => {
        if (root.path === 'Raiz' && (!root.subfolders || root.subfolders.length === 0)) return;

        const chip = document.createElement('button');
        chip.className = `folder-chip ${state.activeFolder === root.path ? 'active' : ''}`;
        chip.dataset.folder = root.path;
        chip.innerHTML = `
            <span>📁 ${root.name}</span>
            <span class="chip-count">${root.count}</span>
        `;

        chip.addEventListener('click', () => {
            foldersBar.querySelectorAll('.folder-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.activeFolder = root.path;
            state.activeSubfolder = '';
            if (subfolderSearchInput) subfolderSearchInput.value = '';

            if (root.subfolders && root.subfolders.length > 0) {
                renderSubfoldersPanel(root);
            } else if (subfoldersPanel) {
                subfoldersPanel.style.display = 'none';
            }

            renderBreadcrumbs();
            refreshView();
        });

        foldersBar.appendChild(chip);
    });

    renderBreadcrumbs();
}

function renderSubfoldersPanel(rootFolder) {
    if (!subfoldersPanel || !subfoldersBar) return;

    if (!rootFolder || !rootFolder.subfolders || rootFolder.subfolders.length === 0) {
        subfoldersPanel.style.display = 'none';
        return;
    }

    subfoldersPanel.style.display = 'flex';
    if (subfoldersPanelTitle) subfoldersPanelTitle.textContent = `Subpastas em ${rootFolder.name}`;
    if (subfoldersCountBadge) subfoldersCountBadge.textContent = rootFolder.subfolders.length;

    const drawChips = (filterText = '') => {
        subfoldersBar.innerHTML = '';

        // Chip "Tudo em X"
        const allSubChip = document.createElement('button');
        allSubChip.className = `subfolder-chip ${!state.activeSubfolder ? 'active' : ''}`;
        allSubChip.innerHTML = `
            <span>✨ Tudo em ${rootFolder.name}</span>
            <span class="chip-count">${rootFolder.count}</span>
        `;
        allSubChip.onclick = () => {
            subfoldersBar.querySelectorAll('.subfolder-chip').forEach(c => c.classList.remove('active'));
            allSubChip.classList.add('active');
            state.activeSubfolder = '';
            renderBreadcrumbs();
            refreshView();
        };
        subfoldersBar.appendChild(allSubChip);

        const query = filterText.toLowerCase().trim();
        const filtered = rootFolder.subfolders.filter(sub => {
            if (!query) return true;
            return sub.name.toLowerCase().includes(query) || sub.path.toLowerCase().includes(query);
        });

        if (filtered.length === 0) {
            const noMatch = document.createElement('span');
            noMatch.style.color = 'var(--text-muted)';
            noMatch.style.fontSize = '0.8rem';
            noMatch.style.padding = '8px';
            noMatch.textContent = `Nenhuma subpasta encontrada para "${filterText}"`;
            subfoldersBar.appendChild(noMatch);
            return;
        }

        filtered.forEach(sub => {
            const subChip = document.createElement('button');
            subChip.className = `subfolder-chip ${state.activeSubfolder === sub.path ? 'active' : ''}`;
            subChip.innerHTML = `
                <span>📂 ${sub.name}</span>
                <span class="chip-count">${sub.count}</span>
            `;
            subChip.onclick = () => {
                subfoldersBar.querySelectorAll('.subfolder-chip').forEach(c => c.classList.remove('active'));
                subChip.classList.add('active');
                state.activeSubfolder = sub.path;
                renderBreadcrumbs();
                refreshView();
            };
            subfoldersBar.appendChild(subChip);
        });
    };

    drawChips(subfolderSearchInput ? subfolderSearchInput.value : '');

    if (subfolderSearchInput) {
        subfolderSearchInput.oninput = (e) => {
            drawChips(e.target.value);
        };
    }
}


// ==========================================
// Mode: Projects View (Grouped by Folder / 3MF)
// ==========================================
async function fetchProjects(isBackground = false) {
    if (!isBackground && modelsGrid.children.length === 0) {
        modelsGrid.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Organizando projetos e montagens...</p>
            </div>
        `;
    }

    try {
        const params = new URLSearchParams();
        const activePath = state.activeSubfolder || state.activeFolder;
        if (activePath) params.append('folder', activePath);
        if (state.search) params.append('search', state.search);
        if (state.statusFilter) params.append('status', state.statusFilter);

        const res = await fetch(`/api/projects?${params.toString()}`);
        const projects = await res.json();
        
        const countChanged = !state.projects || state.projects.length !== projects.length;
        state.projects = projects;

        if (!isBackground || countChanged || modelsGrid.querySelector('.loading-state') || modelsGrid.querySelector('.empty-state')) {
            renderProjects(projects);
        }
    } catch (err) {
        AppLogger.error('API', 'Erro ao carregar projetos', err);
        if (!isBackground && modelsGrid.children.length === 0) {
            modelsGrid.innerHTML = `
                <div class="empty-state">
                    <p>Erro ao carregar projetos do servidor.</p>
                </div>
            `;
        }
    }
}

function renderProjects(projects) {
    if (!projects || projects.length === 0) {
        modelsGrid.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <h3>Nenhum projeto encontrado</h3>
                <p>Tente ajustar os filtros de pasta ou status.</p>
            </div>
        `;
        return;
    }

    modelsGrid.innerHTML = '';
    projects.forEach(item => {
        if (item.type === 'folder_project') {
            renderFolderProjectCard(item);
        } else if (item.type === 'file_3mf_project') {
            render3MFProjectCard(item);
        } else {
            // Arquivo avulso
            const singleModel = item.parts && item.parts.length > 0 ? item.parts[0] : item;
            renderSingleModelCard(singleModel);
        }
    });
}

function renderFolderProjectCard(proj) {
    const card = document.createElement('div');
    card.className = 'model-card card-project';

    const thumbnailHtml = proj.thumbnail_url
        ? `<img class="card-thumbnail" src="${proj.thumbnail_url}" alt="${proj.title}" loading="lazy">`
        : `<div class="thumbnail-placeholder" id="thumbPlaceholderProj-${proj.id.replace(/[^a-zA-Z0-9]/g, '_')}">
             <div class="project-folder-graphic">📁</div>
             <span style="font-size: 0.75rem; color: #94A3B8; font-weight: 600;">Conjunto com ${proj.parts_count} Peças</span>
           </div>`;

    card.innerHTML = `
        <div class="card-badges-top">
            <span class="badge badge-ext">PROJETO DE PASTA</span>
            <span class="badge badge-project">🚀 Projeto</span>
            <span class="project-parts-pill">${proj.parts_count} Peças</span>
        </div>

        <div class="card-preview-area">
            ${thumbnailHtml}
            <div class="card-hover-overlay">
                <span class="btn btn-primary btn-sm">Abrir Projeto (${proj.parts_count} peças)</span>
            </div>
        </div>

        <div class="card-body">
            <h4 class="card-title" title="${proj.title}">${proj.title}</h4>
            <span class="card-path" title="${proj.folder_path}">📁 ${proj.folder_path}</span>
            <span class="card-category-tag">${proj.folder_root}</span>

            <div class="card-metrics">
                <div class="metric-item">
                    <span class="metric-label">Peças</span>
                    <span class="metric-val" style="color: #A5B4FC; font-weight: 700;">${proj.parts_count} arquivos</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Tamanho Total</span>
                    <span class="metric-val">${proj.total_size_mb} MB</span>
                </div>
                <div class="metric-item dimensions-full">
                    <span class="metric-label">Triângulos Totais</span>
                    <span class="metric-val">${Number(proj.total_triangles).toLocaleString()}</span>
                </div>
            </div>

            <div class="card-actions" style="display: grid; grid-template-columns: 1fr auto; gap: 8px;">
                <button class="btn btn-primary btn-sm btn-open-project">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    <span>Abrir Projeto</span>
                </button>
                <button class="btn btn-bambu btn-sm btn-proj-bambu" title="Abrir todas as peças no Bambu Studio">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M4 3h6v8H4zm10 0h6v8h-6zM4 13h6v8H4zm10 0h6v8h-6z"/></svg>
                    <span>Bambu</span>
                </button>
            </div>
        </div>
    `;

    card.querySelector('.card-preview-area').addEventListener('click', () => openProjectModal(proj));
    card.querySelector('.btn-open-project').addEventListener('click', () => openProjectModal(proj));
    const btnProjBambu = card.querySelector('.btn-proj-bambu');
    if (btnProjBambu) {
        btnProjBambu.addEventListener('click', (e) => {
            e.stopPropagation();
            openProjectInBambu(proj.id, proj.title);
        });
    }

    modelsGrid.appendChild(card);
}

function render3MFProjectCard(proj) {
    const model = proj.parts && proj.parts.length > 0 ? proj.parts[0] : null;
    const card = document.createElement('div');
    card.className = 'model-card card-project';

    const thumbnailHtml = proj.thumbnail_url
        ? `<img class="card-thumbnail" src="${proj.thumbnail_url}" alt="${proj.title}" loading="lazy">`
        : `<div class="thumbnail-placeholder">
             <div class="spinner-sm"></div>
             <span style="font-size: 0.7rem; color: #94A3B8;">Projeto 3MF...</span>
           </div>`;

    card.innerHTML = `
        <div class="card-badges-top">
            <span class="badge badge-ext">3MF PROJETO</span>
            <span class="badge badge-project">🚀 Projeto</span>
        </div>

        <div class="card-preview-area">
            ${thumbnailHtml}
            <div class="card-hover-overlay">
                <span class="btn btn-primary btn-sm">Inspecionar Mesas</span>
            </div>
        </div>

        <div class="card-body">
            <h4 class="card-title" title="${proj.title}">${proj.title}</h4>
            <span class="card-path" title="${proj.folder_path}">📁 ${proj.folder_path}</span>
            <span class="card-category-tag">${proj.folder_root}</span>

            <div class="card-metrics">
                <div class="metric-item">
                    <span class="metric-label">Tamanho</span>
                    <span class="metric-val">${proj.total_size_mb} MB</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Triângulos</span>
                    <span class="metric-val">${Number(proj.total_triangles).toLocaleString()}</span>
                </div>
                <div class="metric-item dimensions-full">
                    <span class="metric-label">Fatiador</span>
                    <span class="metric-val" style="color: #38BDF8;">Bambu / OrcaSlicer (Multi-Mesa)</span>
                </div>
            </div>

            <div class="card-actions" style="display: grid; grid-template-columns: 1fr auto; gap: 8px;">
                <button class="btn btn-primary btn-sm btn-open-3d">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                    <span>Ver Mesas/3D</span>
                </button>
                <button class="btn btn-bambu btn-sm btn-3mf-bambu" title="Abrir projeto no Bambu Studio">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M4 3h6v8H4zm10 0h6v8h-6zM4 13h6v8H4zm10 0h6v8h-6z"/></svg>
                    <span>Bambu</span>
                </button>
            </div>
        </div>
    `;

    if (model) {
        card.querySelector('.card-preview-area').addEventListener('click', () => openViewer(model));
        card.querySelector('.btn-open-3d').addEventListener('click', () => openViewer(model));
    }
    const btn3mfBambu = card.querySelector('.btn-3mf-bambu');
    if (btn3mfBambu) {
        btn3mfBambu.addEventListener('click', (e) => {
            e.stopPropagation();
            if (model) {
                openInBambuStudio(model.id, proj.title);
            } else {
                openProjectInBambu(proj.id, proj.title);
            }
        });
    }

    modelsGrid.appendChild(card);
}


// ==========================================
// Mode: Files View (All Individual Models)
// ==========================================
async function fetchModels(isBackground = false) {
    if (!isBackground && modelsGrid.children.length === 0) {
        modelsGrid.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Carregando acervo de arquivos...</p>
            </div>
        `;
    }

    try {
        const params = new URLSearchParams();
        const activePath = state.activeSubfolder || state.activeFolder;
        if (activePath) params.append('folder', activePath);
        if (state.search) params.append('search', state.search);
        if (state.statusFilter) params.append('status', state.statusFilter);
        if (state.isDuplicate !== null) params.append('is_duplicate', state.isDuplicate);
        if (state.isFavorite !== null) params.append('is_favorite', state.isFavorite);
        params.append('sort_by', state.sortBy);
        params.append('order', state.sortOrder);
        params.append('limit', '100');

        const res = await fetch(`/api/models?${params.toString()}`);
        const models = await res.json();
        
        const countChanged = !state.models || state.models.length !== models.length;
        state.models = models;

        if (!isBackground || countChanged || modelsGrid.querySelector('.loading-state') || modelsGrid.querySelector('.empty-state')) {
            renderModels(models);
        }
    } catch (err) {
        AppLogger.error('API', 'Erro ao carregar modelos avulsos', err);
        if (!isBackground && modelsGrid.children.length === 0) {
            modelsGrid.innerHTML = `
                <div class="empty-state">
                    <p>Erro ao carregar modelos do servidor.</p>
                </div>
            `;
        }
    }
}

function renderModels(models) {
    if (!models || models.length === 0) {
        modelsGrid.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <h3>Nenhum modelo encontrado</h3>
                <p>Tente ajustar os filtros ou clique em "Escanear Pastas" para indexar novos arquivos.</p>
            </div>
        `;
        return;
    }

    modelsGrid.innerHTML = '';
    models.forEach(model => renderSingleModelCard(model));
}

function renderSingleModelCard(model) {
    const card = document.createElement('div');
    card.className = 'model-card';

    const statusBadge = getStatusBadge(model);
    const duplicateBadge = model.is_duplicate ? `<span class="badge badge-dup">Duplicata</span>` : '';
    const ext = (model.file_extension || '').replace('.', '').toUpperCase();

    const thumbnailHtml = model.has_thumbnail && model.thumbnail_url
        ? `<img class="card-thumbnail" src="${model.thumbnail_url}" alt="${model.filename}" loading="lazy">`
        : `<div class="thumbnail-placeholder" id="thumbPlaceholder-${model.id}">
             <div class="spinner-sm"></div>
             <span style="font-size: 0.7rem; color: #94A3B8;">Gerando miniatura...</span>
           </div>`;

    const folderBreadcrumb = model.folder_path
        ? `<span class="folder-breadcrumb-pill" title="Pasta: ${model.folder_path}">📁 ${model.folder_path}</span>`
        : '';

    card.innerHTML = `
        <div class="card-badges-top">
            <span class="badge badge-ext">${ext}</span>
            ${statusBadge}
            ${duplicateBadge}
        </div>

        <button class="favorite-btn ${model.is_favorite ? 'active' : ''}" title="Favorito">
            ★
        </button>

        <div class="card-preview-area">
            ${thumbnailHtml}
            <div class="card-hover-overlay">
                <span class="btn btn-primary btn-sm">Abrir 3D</span>
            </div>
        </div>

        <div class="card-body">
            <h4 class="card-title" title="${model.filename}">${model.filename}</h4>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                ${folderBreadcrumb}
                <span class="card-category-tag">${model.category}</span>
            </div>

            <div class="card-metrics">
                <div class="metric-item">
                    <span class="metric-label">Tamanho</span>
                    <span class="metric-val">${model.file_size_mb} MB</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Triângulos</span>
                    <span class="metric-val">${Number(model.triangles_count || 0).toLocaleString()}</span>
                </div>
                <div class="metric-item dimensions-full">
                    <span class="metric-label">Dimensões (X × Y × Z)</span>
                    <span class="metric-val">${model.dimensions ? `${model.dimensions.x} × ${model.dimensions.y} × ${model.dimensions.z} mm` : '--'}</span>
                </div>
            </div>

            <div class="card-actions" style="display: grid; grid-template-columns: 1fr auto auto; gap: 6px;">
                <button class="btn btn-primary btn-sm btn-open-3d">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    <span>3D</span>
                </button>
                <button class="btn btn-bambu btn-sm btn-open-bambu" title="Abrir direto no Bambu Studio">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M4 3h6v8H4zm10 0h6v8h-6zM4 13h6v8H4zm10 0h6v8h-6z"/></svg>
                    <span>Bambu</span>
                </button>
                <a href="/api/models/${model.id}/file" download="${model.filename}" class="btn btn-secondary btn-sm" title="Baixar Arquivo">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                </a>
            </div>
        </div>
    `;

    const btnBambu = card.querySelector('.btn-open-bambu');
    if (btnBambu) {
        btnBambu.addEventListener('click', (e) => {
            e.stopPropagation();
            openInBambuStudio(model.id, model.filename);
        });
    }

    // Queue thumbnail generation if not cached
    if (!model.has_thumbnail) {
        thumbnailRenderer.addToQueue(
            model,
            (dataUrl) => {
                const previewArea = card.querySelector('.card-preview-area');
                const placeholder = card.querySelector(`#thumbPlaceholder-${model.id}`);
                if (previewArea && placeholder) {
                    const img = document.createElement('img');
                    img.className = 'card-thumbnail';
                    img.src = dataUrl;
                    img.alt = model.filename;
                    previewArea.insertBefore(img, previewArea.firstChild);
                    placeholder.remove();
                    model.has_thumbnail = true;
                }
            },
            (err) => {
                const placeholder = card.querySelector(`#thumbPlaceholder-${model.id}`);
                if (placeholder) {
                    placeholder.innerHTML = `
                        <div class="card-thumb-error" title="${err.message}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            <span>Falha 3D</span>
                        </div>
                    `;
                }
            }
        );
    }

    card.querySelector('.card-preview-area').addEventListener('click', () => openViewer(model));
    card.querySelector('.btn-open-3d').addEventListener('click', () => openViewer(model));

    const favBtn = card.querySelector('.favorite-btn');
    favBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newFav = !model.is_favorite;
        try {
            await fetch(`/api/models/${model.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_favorite: newFav })
            });
            model.is_favorite = newFav;
            favBtn.classList.toggle('active', newFav);
        } catch (err) {
            AppLogger.error('API', `Erro ao favoritar modelo ${model.id}`, err);
        }
    });

    modelsGrid.appendChild(card);
}


// ==========================================
// Folder Project Modal (AK47, Butterfly, etc.)
// ==========================================
function openProjectModal(project) {
    AppLogger.info('PROJECT', `Abrindo modal do projeto: ${project.title} (${project.parts_count} peças)`);
    state.activeProject = project;

    projectModalTitle.textContent = project.title;
    projectPartsBadge.textContent = `${project.parts_count} Peças`;
    projectPathHint.textContent = `📁 ${project.folder_path}`;
    projectPartsCount.textContent = project.parts_count;

    projectPartsList.innerHTML = '';
    projectModal.style.display = 'flex';

    onProjectWindowResize();

    const parts = project.parts || [];
    parts.forEach((part, idx) => {
        const item = document.createElement('div');
        item.className = `project-part-item ${idx === 0 ? 'active' : ''}`;
        
        const thumb = part.thumbnail_url 
            ? `<img class="part-item-thumb" src="${part.thumbnail_url}" alt="${part.filename}">`
            : `<div class="part-item-thumb" style="display: flex; align-items: center; justify-content: center; font-size: 0.8rem; color: #94A3B8;">3D</div>`;

        item.innerHTML = `
            ${thumb}
            <div class="part-item-info">
                <span class="part-item-name" title="${part.filename}">${part.filename}</span>
                <span class="part-item-sub">${part.file_size_mb} MB • ${Number(part.triangles_count || 0).toLocaleString()} tris</span>
            </div>
            ${getStatusBadge(part)}
        `;

        item.addEventListener('click', () => {
            projectPartsList.querySelectorAll('.project-part-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            selectProjectPart(part);
        });

        projectPartsList.appendChild(item);
    });

    if (parts.length > 0) {
        selectProjectPart(parts[0]);
    }
}

async function selectProjectPart(part) {
    const thisLoadId = ++activeProjLoadId;
    clearProjScene();

    state.activeProjectPart = part;
    projectActivePartName.textContent = part.filename;
    projectPartMetrics.innerHTML = `
        <span style="color: var(--text-muted); font-size: 0.78rem;">${part.dimensions ? `${part.dimensions.x}×${part.dimensions.y}×${part.dimensions.z} mm` : ''} • ${part.file_size_mb} MB</span>
        ${getStatusBadge(part)}
    `;

    btnDownloadActivePart.href = `/api/models/${part.id}/file`;
    btnDownloadActivePart.setAttribute('download', part.filename);

    projectViewerLoader.style.display = 'flex';
    projectViewerLoader.innerHTML = `<div class="spinner"></div><span>Carregando ${part.filename}...</span>`;

    try {
        const object3d = await load3DFile(part);
        if (thisLoadId !== activeProjLoadId) return;

        clearProjScene();
        const box = new THREE.Box3().setFromObject(object3d);
        const size = box.getSize(new THREE.Vector3());
        object3d.position.y += (size.y / 2);

        projScene.add(object3d);
        currentProjObject = object3d;
        projectViewerLoader.style.display = 'none';

        resetProjCamera();
    } catch (err) {
        if (thisLoadId !== activeProjLoadId) return;
        AppLogger.error('PROJECT', `Falha ao carregar peça ${part.filename}`, err);
        projectViewerLoader.innerHTML = `
            <div style="color: #F43F5E; text-align: center; font-size: 0.82rem; padding: 20px;">
                <span>Não foi possível carregar a peça no visualizador.</span>
            </div>
        `;
    }
}

function closeProjectModal() {
    activeProjLoadId++;
    projectModal.style.display = 'none';
    state.activeProject = null;
    clearProjScene();
}


// ==========================================
// Interactive Three.js Viewports Setup
// ==========================================
function initThreeViewers() {
    // 1. Main 3D Model Viewer
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080C14);
    camera = new THREE.PerspectiveCamera(45, canvasContainer.clientWidth / (canvasContainer.clientHeight || 1), 0.1, 2000);
    camera.position.set(150, 150, 200);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight || 400);
    renderer.setPixelRatio(window.devicePixelRatio);
    canvasContainer.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x6366F1, 1.3);
    dirLight1.position.set(100, 200, 100);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x06B6D4, 0.9);
    dirLight2.position.set(-100, -100, -100);
    scene.add(dirLight2);

    gridHelper = new THREE.GridHelper(220, 22, 0x6366F1, 0x1E293B);
    scene.add(gridHelper);

    // 2. Plate 3D Interactive Viewer (User Request #1)
    plateScene = new THREE.Scene();
    plateScene.background = new THREE.Color(0x080C14);
    plateCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    plateCamera.position.set(150, 150, 200);

    plateRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    plateRenderer.setPixelRatio(window.devicePixelRatio);
    plate3DCanvasContainer.appendChild(plateRenderer.domElement);

    plateControls = new OrbitControls(plateCamera, plateRenderer.domElement);
    plateControls.enableDamping = true;
    plateControls.dampingFactor = 0.05;

    const plateAmbient = new THREE.AmbientLight(0xffffff, 0.8);
    plateScene.add(plateAmbient);
    const plateDir1 = new THREE.DirectionalLight(0x38BDF8, 1.2);
    plateDir1.position.set(100, 200, 100);
    plateScene.add(plateDir1);
    const plateDir2 = new THREE.DirectionalLight(0x818CF8, 0.8);
    plateDir2.position.set(-100, -100, -100);
    plateScene.add(plateDir2);

    plateGridHelper = new THREE.GridHelper(256, 25, 0x38BDF8, 0x1E293B); // Tamanho padrão mesa Bambu (256x256mm)
    plateScene.add(plateGridHelper);

    // 3. Project Part 3D Viewer
    projScene = new THREE.Scene();
    projScene.background = new THREE.Color(0x080C14);
    projCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    projCamera.position.set(120, 120, 150);

    projRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    projRenderer.setPixelRatio(window.devicePixelRatio);
    projectCanvasContainer.appendChild(projRenderer.domElement);

    projControls = new OrbitControls(projCamera, projRenderer.domElement);
    projControls.enableDamping = true;
    projControls.dampingFactor = 0.05;

    const projAmbient = new THREE.AmbientLight(0xffffff, 0.8);
    projScene.add(projAmbient);
    const projDir1 = new THREE.DirectionalLight(0x6366F1, 1.3);
    projDir1.position.set(100, 200, 100);
    projScene.add(projDir1);
    const projDir2 = new THREE.DirectionalLight(0x06B6D4, 0.9);
    projDir2.position.set(-100, -100, -100);
    projScene.add(projDir2);

    projGridHelper = new THREE.GridHelper(200, 20, 0x6366F1, 0x1E293B);
    projScene.add(projGridHelper);

    window.addEventListener('resize', () => {
        onWindowResize();
        onPlateWindowResize();
        onProjectWindowResize();
    });

    // Animation loop unificado
    function animate() {
        requestAnimationFrame(animate);

        if (viewerModal.style.display !== 'none') {
            if (currentViewerMode === '3d' && canvasContainer.style.display !== 'none') {
                controls.update();
                renderer.render(scene, camera);
            } else if (currentViewerMode === 'plates' && state.plateSubMode === '3d') {
                plateControls.update();
                plateRenderer.render(plateScene, plateCamera);
            }
        }

        if (projectModal.style.display !== 'none') {
            projControls.update();
            projRenderer.render(projScene, projCamera);
        }
    }
    animate();
}

function onWindowResize() {
    if (!canvasContainer || viewerModal.style.display === 'none') return;
    const w = canvasContainer.clientWidth;
    const h = canvasContainer.clientHeight;
    if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
}

function onPlateWindowResize() {
    if (!plate3DCanvasContainer || plateFrame3D.style.display === 'none') return;
    const w = plate3DCanvasContainer.clientWidth;
    const h = plate3DCanvasContainer.clientHeight;
    if (w > 0 && h > 0) {
        plateCamera.aspect = w / h;
        plateCamera.updateProjectionMatrix();
        plateRenderer.setSize(w, h);
    }
}

function onProjectWindowResize() {
    if (!projectCanvasContainer || projectModal.style.display === 'none') return;
    const w = projectCanvasContainer.clientWidth;
    const h = projectCanvasContainer.clientHeight;
    if (w > 0 && h > 0) {
        projCamera.aspect = w / h;
        projCamera.updateProjectionMatrix();
        projRenderer.setSize(w, h);
    }
}


// ==========================================
// Multi-Plate Viewer & 3D Plate Inspection
// ==========================================
function switchViewerMode(mode) {
    currentViewerMode = mode;
    if (mode === 'plates') {
        btnTabPlates.classList.add('active');
        btnTab3D.classList.remove('active');
        plateViewerContainer.style.display = 'flex';
        canvasContainer.style.display = 'none';
        if (currentPlatesData && currentPlatesData.plates && currentPlatesData.plates.length > 0) {
            selectPlate(activePlateIndex);
        }
    } else if (mode === '3d') {
        if (btnTab3D.classList.contains('disabled')) return;
        btnTab3D.classList.add('active');
        btnTabPlates.classList.remove('active');
        plateViewerContainer.style.display = 'none';
        canvasContainer.style.display = 'block';
        onWindowResize();
        if (state.activeModel) {
            load3DScene(state.activeModel);
        }
    }
}

function switchPlateSubMode(subMode) {
    state.plateSubMode = subMode;
    if (subMode === '2d') {
        activePlateLoadId++;
        clearPlateScene();
        btnPlateView2D.classList.add('active');
        btnPlateView3D.classList.remove('active');
        plateFrame2D.style.display = 'block';
        plateFrame3D.style.display = 'none';
    } else {
        btnPlateView3D.classList.add('active');
        btnPlateView2D.classList.remove('active');
        plateFrame2D.style.display = 'none';
        plateFrame3D.style.display = 'block';
        onPlateWindowResize();

        if (currentPlatesData && currentPlatesData.plates) {
            const plate = currentPlatesData.plates[activePlateIndex];
            if (plate) {
                loadPlate3DMesh(state.activeModel.id, plate.index);
            }
        }
    }
}

async function loadPlate3DMesh(modelId, plateNum) {
    const thisLoadId = ++activePlateLoadId;
    clearPlateScene();
    currentPlate3DNum = `${modelId}_${plateNum}`;

    plate3DLoader.style.display = 'flex';
    plate3DLoader.innerHTML = `<div class="spinner"></div><span>Extraindo malha 3D da mesa ${plateNum}...</span>`;

    try {
        AppLogger.info('PLATE_3D', `Baixando modelo 3D otimizado para mesa ${plateNum}...`);
        const loader = new GLTFLoader();
        loader.load(`/api/models/${modelId}/plates/${plateNum}/mesh.glb`, (gltf) => {
            if (thisLoadId !== activePlateLoadId) {
                // Requisição obsoleta descartada
                return;
            }
            clearPlateScene();
            currentPlate3DNum = `${modelId}_${plateNum}`;

            const group = gltf.scene;
            const box = new THREE.Box3().setFromObject(group);
            const center = box.getCenter(new THREE.Vector3());

            // Centralizar horizontalmente e posicionar base sobre a mesa (Y=0)
            group.position.x = -center.x;
            group.position.z = -center.z;
            group.position.y = -box.min.y;

            group.traverse((child) => {
                if (child.isMesh) {
                    child.geometry.computeVertexNormals();
                    if (!child.material || child.material.color.getHex() === 0xffffff) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0x38BDF8,
                            roughness: 0.35,
                            metalness: 0.12
                        });
                    }
                }
            });

            plateScene.add(group);
            currentPlateObject = group;
            plate3DLoader.style.display = 'none';
            AppLogger.info('PLATE_3D', `✓ Mesa ${plateNum} renderizada em 3D com sucesso.`);

            resetPlateCamera();
        }, undefined, (err) => {
            if (thisLoadId !== activePlateLoadId) return;
            AppLogger.error('PLATE_3D', `Falha ao carregar 3D da mesa ${plateNum}`, err);
            plate3DLoader.innerHTML = `
                <div style="color: #F43F5E; text-align: center; font-size: 0.85rem; padding: 20px;">
                    <p style="margin-bottom: 6px; font-weight: 600;">Visualização 3D individual desta mesa não disponível.</p>
                    <span style="font-size: 0.78rem; color: #94A3B8;">Use a aba "Foto da Mesa" para inspecionar o fatiamento original com precisão ou abra no Bambu Studio.</span>
                </div>
            `;
        });
    } catch (e) {
        if (thisLoadId !== activePlateLoadId) return;
        AppLogger.error('PLATE_3D', `Erro ao solicitar malha 3D da mesa ${plateNum}`, e);
    }
}

function preloadPlate3DMesh(modelId, plateNum) {
    if (!modelId || !plateNum) return;
    fetch(`/api/models/${modelId}/plates/${plateNum}/mesh.glb`)
        .then(() => AppLogger.debug('PREFETCH', `✓ Mesa ${plateNum} pré-carregada no cache.`))
        .catch(() => {});
}

async function updateCacheStatus() {
    try {
        const res = await fetch('/api/cache/status');
        const data = await res.json();
        const cacheUsageText = document.getElementById('cacheUsageText');
        if (cacheUsageText) {
            cacheUsageText.textContent = `${data.total_size_mb} MB / ${data.max_size_mb} MB (${data.files_count} arquivos)`;
        }
    } catch (e) {
        console.error('Erro ao obter status de cache:', e);
    }
}

function resetPlateCamera() {
    if (!currentPlateObject) return;
    const box = new THREE.Box3().setFromObject(currentPlateObject);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = (sphere && sphere.radius > 0) ? sphere.radius : 60;

    plateCamera.near = Math.max(0.01, radius / 500);
    plateCamera.far = Math.max(2000, radius * 50);
    plateCamera.updateProjectionMatrix();

    plateCamera.position.set(radius * 1.8, radius * 1.5, radius * 2.2);
    plateControls.target.set(0, box.max.y / 2, 0);
    plateControls.update();
}

function resetProjCamera() {
    if (!currentProjObject) return;
    const box = new THREE.Box3().setFromObject(currentProjObject);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = (sphere && sphere.radius > 0) ? sphere.radius : 40;

    projCamera.near = Math.max(0.01, radius / 500);
    projCamera.far = Math.max(2000, radius * 50);
    projCamera.updateProjectionMatrix();

    projCamera.position.set(radius * 1.8, radius * 1.5, radius * 2.2);
    projControls.target.set(0, currentProjObject.position.y, 0);
    projControls.update();
}

function renderPlatesStrip(plates) {
    platesStrip.innerHTML = '';
    plates.forEach((plate, idx) => {
        const item = document.createElement('button');
        item.className = `plate-strip-item ${idx === activePlateIndex ? 'active' : ''}`;
        
        let subText = '';
        if (plate.print_time_str) {
            subText = plate.print_time_str;
        } else if (plate.filament_weight_g) {
            subText = `${plate.filament_weight_g}g`;
        } else if (plate.objects && plate.objects.length > 0) {
            subText = `${plate.objects.length} peça(s)`;
        } else {
            subText = `Mesa ${plate.index}`;
        }

        item.innerHTML = `
            <img class="plate-strip-thumb" src="${plate.thumb_url || plate.image_url}" alt="${plate.title}" loading="lazy" />
            <div class="plate-strip-meta">
                <span class="plate-strip-title">${plate.title}</span>
                <span class="plate-strip-sub">${subText}</span>
            </div>
        `;

        item.addEventListener('click', () => {
            selectPlate(idx);
        });

        platesStrip.appendChild(item);
    });
}

function selectPlate(index) {
    if (!currentPlatesData || !currentPlatesData.plates || currentPlatesData.plates.length === 0) return;
    if (index < 0) index = 0;
    if (index >= currentPlatesData.plates.length) index = currentPlatesData.plates.length - 1;

    activePlateIndex = index;
    const plate = currentPlatesData.plates[index];

    // Atualiza classes ativas na strip e rola
    const items = platesStrip.querySelectorAll('.plate-strip-item');
    items.forEach((item, i) => {
        if (i === index) {
            item.classList.add('active');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
            item.classList.remove('active');
        }
    });

    // Se estiver em modo 3D, carrega malha da nova mesa selecionada
    if (state.plateSubMode === '3d') {
        loadPlate3DMesh(state.activeModel.id, plate.index);
    } else {
        activePlateLoadId++;
        clearPlateScene();
        // Pré-carrega a malha 3D da mesa em segundo plano silencioso
        preloadPlate3DMesh(state.activeModel.id, plate.index);
    }

    // Atualiza imagem 2D principal
    plateMainImg.style.opacity = '0.3';
    plateMainImg.onload = () => { plateMainImg.style.opacity = '1'; };
    plateMainImg.onerror = () => { plateMainImg.style.opacity = '1'; };
    plateMainImg.src = plate.image_url;

    // Atualiza card de informações da mesa
    plateCardTitle.textContent = plate.title || `Mesa ${plate.index}`;
    plateCardIndexTag.textContent = `${index + 1} de ${currentPlatesData.total_plates}`;
    plateMetricTime.textContent = plate.print_time_str || '--';
    plateMetricWeight.textContent = plate.filament_weight_g ? `${plate.filament_weight_g} g` : '--';

    if (plate.filament_color) {
        plateFilDot.style.display = 'inline-block';
        plateFilDot.style.backgroundColor = plate.filament_color;
    } else {
        plateFilDot.style.display = 'none';
    }
    plateMetricFilType.textContent = plate.filament_type || (plate.filament_weight_g ? 'PLA' : '--');

    plateMetricBed.textContent = plate.bed_type 
        ? plate.bed_type.replace(/_/g, ' ').toUpperCase() 
        : (plate.nozzle_diameter ? `Bico ${plate.nozzle_diameter}mm` : 'Mesa Aquecida');

    if (plate.objects && plate.objects.length > 0) {
        plateObjectsWrap.style.display = 'flex';
        plateObjectsList.innerHTML = plate.objects.map(obj => `<span class="plate-obj-pill" title="${obj}">${obj}</span>`).join('');
    } else {
        plateObjectsWrap.style.display = 'none';
    }

    AppLogger.info('VIEWER', `Visualizando ${plate.title} (${index + 1}/${currentPlatesData.total_plates})`);
}


// ==========================================
// Single Model 3D Scene Loader
// ==========================================
async function load3DScene(model) {
    if (is3DLoadedForCurrentModel && currentObject) return;
    const thisLoadId = ++activeMainLoadId;

    viewerLoader.style.display = 'flex';
    viewerLoader.innerHTML = `
        <div class="spinner"></div>
        <span>Carregando arquivo 3D (${model.file_size_mb} MB)...</span>
    `;

    clearMainScene();

    try {
        const object3d = await load3DFile(model);
        if (thisLoadId !== activeMainLoadId) return;

        clearMainScene();
        const box = new THREE.Box3().setFromObject(object3d);
        const size = box.getSize(new THREE.Vector3());
        object3d.position.y += (size.y / 2);

        scene.add(object3d);
        currentObject = object3d;
        viewerLoader.style.display = 'none';
        is3DLoadedForCurrentModel = true;

        AppLogger.info('VIEWER', `✓ Modelo ${model.filename} renderizado com sucesso no viewport.`);
        resetCamera();
    } catch (err) {
        if (thisLoadId !== activeMainLoadId) return;
        AppLogger.error('VIEWER', `Falha ao abrir modelo ${model.filename}`, err);
        viewerLoader.innerHTML = `
            <div style="color: #F43F5E; text-align: center; max-width: 480px; padding: 20px;">
                <svg style="width: 44px; height: 44px; margin-bottom: 8px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <h4 style="margin-bottom: 6px;">Não foi possível carregar o modelo 3D</h4>
                <p style="color: #94A3B8; font-family: monospace; font-size: 0.82rem; background: rgba(0,0,0,0.4); padding: 8px; border-radius: 6px; word-break: break-word;">${err.message || err}</p>
                <button class="btn btn-secondary btn-sm" style="margin-top: 12px;" onclick="document.getElementById('debugDrawer').style.display='flex'">Ver no Console de Logs</button>
            </div>
        `;
    }
}

async function openViewer(model) {
    AppLogger.info('VIEWER', `Abrindo visualizador para [${model.id}] ${model.filename}...`);
    activePlateLoadId++;
    activeMainLoadId++;
    clearPlateScene();
    clearMainScene();

    state.activeModel = model;
    is3DLoadedForCurrentModel = false;
    currentPlatesData = null;
    activePlateIndex = 0;
    currentPlate3DNum = null;

    modalModelTitle.textContent = model.filename;
    modalDownloadBtn.href = `/api/models/${model.id}/file`;
    modalDownloadBtn.setAttribute('download', model.filename);

    overlayDim.textContent = model.dimensions ? `${model.dimensions.x} × ${model.dimensions.y} × ${model.dimensions.z} mm` : '--';
    overlayTris.textContent = Number(model.triangles_count || 0).toLocaleString();
    overlayVolume.textContent = `${model.volume_cm3 || 0} cm³`;

    const statusBadge = getStatusBadge(model);
    overlayWatertight.innerHTML = statusBadge;

    modalBadges.innerHTML = `
        <span class="badge badge-ext">${(model.file_extension || '').replace('.', '').toUpperCase()}</span>
        ${statusBadge}
    `;

    viewerModal.style.display = 'flex';

    const ext = (model.file_extension || '').toLowerCase();
    const isMegaproject = (model.file_size_mb > 35 || model.triangles_count > 1500000);

    if (ext === '.3mf') {
        try {
            const resp = await fetch(`/api/models/${model.id}/plates`);
            if (resp.ok) {
                const platesData = await resp.json();
                if (platesData.is_project && platesData.plates && platesData.plates.length > 0) {
                    currentPlatesData = platesData;
                    modalModeSwitch.style.display = 'flex';
                    platesStripContainer.style.display = 'flex';
                    tabPlatesLabel.textContent = `Mesas (${platesData.total_plates})`;

                    if (isMegaproject) {
                        megaprojectNotice.style.display = 'block';
                        btnTab3D.classList.add('disabled');
                        btnTab3D.title = 'Malha 3D completa desabilitada para projetos gigantes (>20M triângulos). Use o visualizador 3D por mesa.';
                    } else {
                        megaprojectNotice.style.display = 'none';
                        btnTab3D.classList.remove('disabled');
                        btnTab3D.title = 'Visualizador 3D Interativo Completo';
                    }

                    renderPlatesStrip(platesData.plates);
                    switchViewerMode('plates');
                    switchPlateSubMode('2d');
                    selectPlate(0);
                    return;
                }
            }
        } catch (e) {
            AppLogger.warn('VIEWER', `Não foi possível carregar mesas do 3MF: ${e.message}`);
        }
    }

    modalModeSwitch.style.display = 'none';
    platesStripContainer.style.display = 'none';
    switchViewerMode('3d');
    load3DScene(model);
}

function resetCamera() {
    if (!currentObject) return;
    const box = new THREE.Box3().setFromObject(currentObject);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = (sphere && sphere.radius > 0) ? sphere.radius : 50;

    camera.near = Math.max(0.01, radius / 500);
    camera.far = Math.max(2000, radius * 50);
    camera.updateProjectionMatrix();

    camera.position.set(radius * 1.8, radius * 1.5, radius * 2.2);
    controls.target.set(0, currentObject.position.y, 0);
    controls.update();
}

function closeModal() {
    activePlateLoadId++;
    activeMainLoadId++;
    viewerModal.style.display = 'none';
    is3DLoadedForCurrentModel = false;
    currentPlatesData = null;
    currentPlate3DNum = null;
    clearPlateScene();
    clearMainScene();
}


// ==========================================
// Background Scan Polling
// ==========================================
let lastScannedCount = 0;
let isManualScanRequested = false;

function startPollingScan(isManual = false) {
    if (isManual) isManualScanRequested = true;
    if (state.pollInterval) clearInterval(state.pollInterval);
    state.pollInterval = setInterval(checkScanStatus, 1000);
    checkScanStatus();
}

async function checkScanStatus() {
    try {
        const res = await fetch('/api/scan/status');
        const status = await res.json();

        if (status.is_scanning) {
            scanProgressBanner.style.display = 'flex';
            scanProgressBar.style.width = `${status.percentage}%`;
            scanProgressPercent.textContent = `${status.percentage}%`;
            scanCurrentFile.textContent = status.current_file;
            scanStatusTitle.textContent = `Indexando novos arquivos (${status.processed_files}/${status.total_files}) • Você já pode usar e explorar os modelos abaixo!`;

            if (!state.pollInterval) {
                state.pollInterval = setInterval(checkScanStatus, 1000);
            }

            // Atualização dinâmica em tempo real à medida que novos arquivos entram no banco
            if (status.processed_files >= lastScannedCount + 4 || (lastScannedCount === 0 && status.processed_files > 0)) {
                lastScannedCount = status.processed_files;
                fetchStats();
                fetchFolders();
                if (document.activeElement !== searchInput && viewerModal.style.display === 'none' && projectModal.style.display === 'none') {
                    refreshView(true);
                }
            }
        } else {
            scanProgressBanner.style.display = 'none';
            if (state.pollInterval) {
                clearInterval(state.pollInterval);
                state.pollInterval = null;
                AppLogger.info('SCAN', 'Varredura finalizada. Atualizando acervo...');
                fetchStats();
                fetchFolders();
                refreshView(false);
                if (isManualScanRequested) {
                    isManualScanRequested = false;
                    showToast('Acervo Sincronizado', 'Biblioteca 100% atualizada.', 'success', 3000);
                }
            }
        }
    } catch (err) {
        AppLogger.error('SCAN', 'Erro ao verificar status da varredura', err);
    }
}

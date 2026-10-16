# 🧊 STLManager

> **Gerenciador e Visualizador Web Inteligente para Acervos de Impressão 3D (STL, 3MF, OBJ)**  
> Organização automática em projetos, inspeção 3D interativa de multi-mesas, análise de estanqueidade e geração de miniaturas.

---

## ✨ Destaques e Funcionalidades

- **🚀 Agrupamento Automático por Projetos:**
  - Pastas contendo modelos divididos em várias peças (ex: réplicas de armas do CS:GO, action figures, miniaturas) são unificadas em **Cards de Projetos**, eliminando a bagunça de peças soltas.
  - **Modal de Montagem:** Navegue pela lista lateral de componentes com informações de peso/volume e inspecione cada peça em 3D interativo antes da impressão.

- **🖨️ Suporte Avançado a 3MF do Bambu Lab / OrcaSlicer:**
  - Reconhecimento automático de metadados de fatiamento (tempo estimado, peso em gramas, tipo e cor de filamento, mesa utilizada).
  - **Inspeção 3D por Mesa:** Alterne entre a **Foto da Mesa** (render original do fatiador) e o **3D desta Mesa** (malha interativa renderizada via Three.js), mesmo em projetos colossais com mais de 20 mesas.

- **🛡️ Classificação Tripla de Status:**
  - `🚀 Projeto`: Montagens multi-peças e arquivos multi-mesas.
  - `🛡️ Sólido`: Malhas estanques (*watertight*), herméticas e prontas para impressão direta sem erros de slice.
  - `⚠️ Não-Sólido`: Malhas abertas, com furos ou bordas desconexas que necessitam de reparo prévio.

- **⚡ Miniaturas e Cache Otimizado:**
  - Gerador de thumbnails 3D em segundo plano com iluminação de estúdio.
  - Cache permanente no banco SQLite local para carregamento instantâneo do acervo.

- **🔍 Filtros e Busca em Tempo Real:**
  - Navegação visual por pastas e subpastas.
  - Pílulas de filtro por status (`Todos`, `Projetos`, `Sólidos`, `Não-Sólidos`), favoritos e duplicatas.

- **🩺 Console de Diagnóstico (Logs de Debug):**
  - Drawer retrátil na interface para acompanhar em tempo real carregamentos, varreduras do scanner e métricas da GPU/WebGL.

---

## 🚀 Como Rodar com Docker

O projeto é 100% conteinerizado e compatível tanto com **Windows (Docker Desktop)** quanto com **Linux / macOS**.

### 1. Pré-requisitos
- [Docker](https://docs.docker.com/get-docker/) e [Docker Compose](https://docs.docker.com/compose/) instalados e rodando.

---

### 💻 No Windows

1. **Abra o terminal (PowerShell ou Prompt de Comando)** na pasta do projeto:
   ```powershell
   git clone <URL_DO_REPOSITORIO>
   cd STLManager
   ```

2. **Crie o seu arquivo de configuração `.env`:**
   ```powershell
   copy .env.example .env
   ```

3. **Edite o `.env`** com o caminho da sua pasta de arquivos 3D no Windows.  
   > ⚠️ **Importante no Windows:** Use barras normais `/` no caminho:
   ```env
   # Exemplo com Downloads:
   STL_LIBRARY_PATH=C:/Users/SeuUsuario/Downloads

   # Ou um HD secundário / pasta de modelos:
   # STL_LIBRARY_PATH=D:/Modelos3D
   ```

4. **Inicie o STLManager:**
   ```powershell
   docker compose up -d
   ```

5. **Acesse no seu navegador:**
   👉 [http://localhost:8000](http://localhost:8000)

---

### 🐧 No Linux / macOS

1. **Clone e entre na pasta:**
   ```bash
   git clone <URL_DO_REPOSITORIO>
   cd STLManager
   ```

2. **Crie o arquivo `.env`:**
   ```bash
   cp .env.example .env
   ```

3. **Configure a variável no `.env`:**
   ```env
   STL_LIBRARY_PATH=/home/seu_usuario/Downloads
   ```

4. **Suba os containers:**
   ```bash
   docker compose up -d
   ```

5. **Acesse:**
   👉 [http://localhost:8000](http://localhost:8000)

---

## 🛠️ Comandos Úteis do Docker

| Ação | Comando |
| :--- | :--- |
| **Iniciar em segundo plano** | `docker compose up -d` |
| **Ver logs em tempo real** | `docker compose logs -f stlmanager` |
| **Parar a aplicação** | `docker compose down` |
| **Reconstruir imagem após mudanças** | `docker compose up -d --build` |
| **Reiniciar aplicação** | `docker compose restart` |

---

## 📁 Estrutura do Repositório

```text
STLManager/
├── backend/
│   ├── app/
│   │   ├── main.py            # API FastAPI, rotas de modelos, GLB e scanner
│   │   ├── scanner.py         # Leitor e analisador assíncrono de arquivos 3D
│   │   ├── folders.py         # Motor de árvores de diretórios e montagem de projetos
│   │   ├── categorizer.py     # Classificador automático por pastas e tags
│   │   ├── models.py          # Definições do banco de dados (SQLite/SQLAlchemy)
│   │   └── static/            # Frontend SPA (Vanilla JS + CSS moderno + Three.js)
│   │       ├── index.html     # Dashboard, modais de projeto e visualizador 3D
│   │       ├── style.css      # Design system Dark/Glassmorphism responsivo
│   │       └── app.js         # Lógica da aplicação, Three.js viewports e controles
│   ├── requirements.txt       # Dependências Python (trimesh, fastapi, aiosqlite, etc.)
│   └── Dockerfile             # Imagem Docker otimizada baseada em Python 3.12-slim
├── data/                      # Persistência do banco SQLite, previews e miniaturas
│   ├── stlmanager.db          # Banco de dados indexado (ignorado no git)
│   └── library/               # Pasta fallback para modelos
├── .env.example               # Modelo de variáveis de ambiente para Windows/Linux
├── docker-compose.yml         # Orquestração do container, volumes e portas
└── README.md                  # Este guia
```

---

## 🧩 Tecnologias Utilizadas

- **Backend:** Python 3.12, [FastAPI](https://fastapi.tiangolo.com/), Uvicorn, SQLAlchemy + aiosqlite (Assíncrono).
- **Processamento 3D:** [Trimesh](https://trimesh.org/), NumPy, ElementTree (parseamento XML de arquivos 3MF e fatiadores Bambu/Orca).
- **Frontend:** Vanilla JavaScript (ES Modules), CSS3 Puro com Variáveis e Glassmorphism.
- **Renderização 3D:** [Three.js](https://threejs.org/) (OrbitControls, STLLoader, GLTFLoader, OBJLoader).
- **Deploy:** Docker & Docker Compose.

---

## 💡 Dicas de Uso
- **Novo Escaneamento:** Ao adicionar novos arquivos na sua pasta, basta clicar no botão **"Escanear Pastas"** no topo da página. O processo roda em segundo plano sem travar a navegação.
- **Abrir no Fatiador:** No card de cada modelo ou dentro do modal de projetos, o botão de download permite baixar o arquivo ou abri-lo diretamente no seu fatiador padrão (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura).

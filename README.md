# Dots Strategy (Angular + Capacitor Edition)

Un juego de Gran Estrategia en Tiempo Real (RTS) optimizado para dispositivos móviles, desarrollado con **Angular 18**, **Capacitor**, y **PeerJS**. Inspirado en las mecánicas tácticas de *War of Dots*, pero evolucionado hacia una experiencia de escala masiva con un estilo visual Sci-Fi holográfico.

## 🚀 Características Principales

### 1. Sistema Numérico Masivo y Economía Ralentizada
* Sustitución de barras de vida por indicadores numéricos dinámicos (Ej: `100K`, `2.5M`).
* Economía de desgaste (Attrition) y "Pacing" estratégico: Las tropas se generan y mueven a un ritmo que permite la planificación a gran escala, emboscadas e intercepciones.
* Sistema de **Hambruna (Starvation/Cap)**: Los nodos tienen un límite de población. Si se excede, las tropas decaen.

### 2. Topografía y Nodos Especializados
* **Ciudades:** Generación estándar de tropas ligeras.
* **Fortalezas:** Generación lenta, pero reducen el daño recibido en un 50%.
* **Forjas:** Producen unidades **Pesadas (Heavy)**. Más lentas, pero infligen el doble de daño y tienen mayor fuerza de empuje físico.
* **Campamentos (Camps):** Nodos temporales creados al enviar tropas a cualquier punto vacío del mapa. Perfectos para establecer cabezas de playa o flanquear.

### 3. Físicas de Combate y Control Territorial (Frontlines)
* **Colisión Física:** Los enjambres de tropas empujan físicamente a los nodos enemigos al impactar.
* **Líneas de Frente Dinámicas:** Un sistema optimizado basado en HTML5 `<canvas>` que mezcla auras de color (`globalCompositeOperation = 'lighter'`) para dibujar visualmente las fronteras de influencia de cada facción en tiempo real.

### 4. Multijugador P2P Descentralizado (1vs1)
* Implementación nativa de **PeerJS** (WebRTC).
* Partidas alojadas de dispositivo a dispositivo sin necesidad de servidores centrales de juego.
* Sistema de "Host" (emite el estado físico y simulación) y "Client" (envía comandos tácticos).

### 5. Exploración de Mapa Masivo (4000x4000)
* Soporte táctil nativo para **Pinch-to-Zoom** (Pellizcar para acercar/alejar).
* Desplazamiento de cámara (**Pan**) para navegar por el extenso campo de batalla.
* Generación aleatoria de mapas: `Standard`, `Chokepoint`, y `Scattered`.

### 6. Orquestador de Agentes (Simulador IA)
Enfrenta a dos perfiles de Inteligencia Artificial para probar tácticas:
* **IA Micro (Frenética):** Alto APM (Acciones por Minuto), ataca constantemente en pequeños enjambres.
* **IA Macro (Gran Estrategia):** Reacciona lentamente, mejora su economía y lanza ataques masivos coordinados cuando tiene superioridad numérica.

### 7. Optimización y Rendimiento (Settings)
* Auto-detección de hardware móvil para ajustar la carga gráfica.
* Control de **FPS (30 o 60)** para ahorrar batería.
* Escala de resolución dinámica del Canvas de territorio (50%, 75%, 100%) para mantener el rendimiento fluido en dispositivos de gama baja.
* UI Sci-Fi con "Glassmorphism" y fuentes `Orbitron` / `Rajdhani`.

## 📱 Compilación y Despliegue Multiplataforma

El código fuente está preparado para compilarse nativamente para múltiples plataformas usando una sola base de código (Angular + Capacitor + Electron).

### 1. Android (APK)
1. Instalar dependencias Node: `npm install`
2. Construir la aplicación web Angular: `npm run build`
3. Sincronizar los assets: `npx cap sync android`
4. Compilar el APK: Abre la carpeta `/android` en Android Studio y ejecuta `Build -> Build APK(s)`, o usa Gradle: `cd android && ./gradlew assembleDebug`

### 2. Windows (EXE)
El juego utiliza un motor embebido de Electron de alto rendimiento.
1. Compilar para Windows: `npm run electron:build`
2. El ejecutable portable quedará listo dentro de la carpeta `release/DotsStrategy-win32-x64/`.

### 3. Mac (macOS .APP)
Para mantener el Crossplay en ecosistemas de Apple, debes compilar el código *desde una computadora Mac* (ya que requiere la creación de *Symlinks* nativos de Unix).
1. En tu Mac, clona el repositorio y ejecuta `npm install`.
2. Compila el binario de Mac: `npm run electron:build:mac`
3. La aplicación de Mac quedará generada en la carpeta `release/DotsStrategy-darwin-x64/`.

## 👨‍💻 Créditos
Desarrollo de la experiencia y mecánicas orquestado por **BABYLON.IA**.

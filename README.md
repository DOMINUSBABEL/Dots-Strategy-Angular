# Dots Strategy Angular Edition
Un juego de estrategia optimizado para dispositivos móviles, desarrollado con **Angular 18**, **Capacitor** y **Angular Animations**.

## Características Implementadas
* **Interfaz BABYLON.IA:** Pantalla de inicio de entrada (Splash Screen) con enlace a BABYLON.IA.
* **Sistema Numérico Masivo:** Implementado para abreviar ejércitos gigantescos con sufijos (100K, 2.5M).
* **Motor Angular Animations:** Animaciones con transiciones de escala al recibir tropas.
* **WebRTC/P2P Setup:** Listo en arquitectura para el módulo multijugador (mocks actuales generados vía AI host local en la lógica de `app.component.ts`).
* **Controles Touch Móviles First:** El usuario puede seleccionar nodos y deslizar su dedo hacia un objetivo para enviar tropas, un aspecto fundamental para pantallas Android/iOS (TouchEvent nativos con interpolación visual).

## Compilación a APK (Android 14)
El código de la aplicación está totalmente desarrollado y sincronizado para compilar en Android nativo. Debido a que requiere las SDKs de Android, se compila usando Android Studio o CLI de forma local con las herramientas de Java.

Para obtener el **.apk** o **.aab**:
1. `npm install`
2. `npm run build`
3. `npx cap sync android`
4. `npx cap open android` (O abrir la carpeta `/android` directamente en Android Studio)
5. En Android Studio -> Build -> Build Bundle(s) / APK(s) -> Build APK(s).

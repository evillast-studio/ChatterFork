# Compilar ChatterUI para Kirin 710 (Cortex-A73)

## Por qué compilar propio .so

El APK genérico de ChatterUI compila para `armv8-a` genérico sin ningún tuning.
Compilando específicamente para **Cortex-A73** se gana:
- `−march=armv8-a` exacto (sin riesgo de dotprod que crashea en A73)
- `−mtune=cortex-a73` — scheduling de instrucciones para el pipeline de 11 etapas del A73
- `−O3 −ffast-math` — matemáticas relajadas (seguro para inferencia)
- **~10-20% más t/s** en práctica

## Requisitos

| Herramienta | Versión mínima | Instalar |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| JDK | 17 | `sudo apt install openjdk-17-jdk` |
| Android SDK | cualquiera | Android Studio |
| Android NDK | r25+ | SDK Manager → NDK |
| CMake | 3.22+ | `sudo apt install cmake` |

**En Windows**: usar WSL2 con Ubuntu 22.04.

## Cómo funciona el parche

`expo-build-plugins/kirin710.plugin.js` inyecta este bloque en el `CMakeLists.txt`
de `cui-llama.rn` automáticamente durante `expo prebuild`:

```cmake
if(ANDROID AND ANDROID_ABI STREQUAL "arm64-v8a")
    set(K710_FLAGS "-march=armv8-a -mtune=cortex-a73 -O3 -ffast-math -funroll-loops")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${K710_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${K710_FLAGS}" CACHE STRING "" FORCE)
    set(GGML_DOTPROD OFF CACHE BOOL "A73 no tiene dotprod" FORCE)  # ← CRÍTICO
    set(GGML_NEON ON CACHE BOOL "" FORCE)
endif()
```

> ⚠️ `GGML_DOTPROD OFF` es **crítico**. El compilador NDK soporta el flag aunque
> el A73 no lo tenga. Sin esto, el .so puede generar instrucciones ilegales que
> crashean con `SIGILL` en runtime.

## Build local (recomendado)

```bash
# 1. Clonar/tener el código fuente
cd ChatterUI-0.10.0-beta5

# 2. Exportar NDK (ajustar path)
export ANDROID_NDK_HOME=~/Android/Sdk/ndk/27.2.12479018

# 3. Correr el script
./build-kirin710.sh

# 4. Instalar en el teléfono (con USB + ADB habilitado)
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Build via EAS (en la nube, sin NDK local)

```bash
npm install -g eas-cli
eas login
eas build --profile kirin710 --platform android
```

## Verificar que el .so es correcto

Después de instalar, en los logs de ChatterUI al cargar un modelo debería aparecer:
```
[Kirin710] Applying Cortex-A73 optimizations
```

O verificar con:
```bash
# Extraer el .so del APK
unzip app-release.apk lib/arm64-v8a/librn_llama.so
# Ver los flags de compilación embebidos
strings lib/arm64-v8a/librn_llama.so | grep -E "cortex|march|mtune"
```

## Configuración óptima en la app (preset Kirin 710)

Una vez instalado el APK compilado, en Model Settings aplicar el preset **⚡ Kirin 710**:
- Threads: 4 (solo big cores A73)
- CPU Mask: `4-7` + cpu_strict ON
- Batch: 512, uBatch: 128
- KV Cache: q8_0 / q8_0
- Flash Attention: off
- n_keep: 256, defrag_thold: 10%

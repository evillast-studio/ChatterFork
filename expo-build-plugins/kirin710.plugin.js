/**
 * kirin710.plugin.js
 * 
 * Expo config plugin que parchea el CMakeLists.txt de cui-llama.rn
 * durante el prebuild para compilar el .so optimizado para Cortex-A73.
 * 
 * Cortex-A73 (Kirin 710) specs relevantes:
 *   - ARMv8-A (SIN dotprod — eso es ARMv8.2-A → SIGILL en A73)
 *   - NEON 128-bit SIMD: SÍ
 *   - FP16 hardware: NO
 *   - L1 D-cache: 32KB, L2: 256KB/core, L3 shared: 1MB
 *   - Pipeline: 11 etapas, 2-wide decode, OoO
 */

const { withDangerousMod } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')

const MARKER = '# __KIRIN710_INJECTED__'

const K710_CMAKE_BLOCK = `
${MARKER}
# ── Kirin 710 / Cortex-A73 native optimization ─────────────────────────────
# Aplicado por expo-build-plugins/kirin710.plugin.js
# Cortex-A73 es ARMv8-A puro. NO soporta dotprod (ARMv8.2-A).
# Activar dotprod causa SIGILL (illegal instruction) en runtime.
if(ANDROID AND ANDROID_ABI STREQUAL "arm64-v8a")
    message(STATUS "")
    message(STATUS "===================================================")
    message(STATUS " Kirin 710 / Cortex-A73 optimization ACTIVE")
    message(STATUS " ABI: arm64-v8a | march: armv8-a | tune: cortex-a73")
    message(STATUS "===================================================")
    message(STATUS "")

    set(K710_C_FLAGS
        -march=armv8-a          # ARMv8-A base — seguro en A73
        -mtune=cortex-a73       # Scheduling optimizado para pipeline A73
        -O3                     # Máxima optimización
        -ffast-math             # Relajar precisión IEEE para más velocidad
        -fno-math-errno         # No setear errno en funciones math
        -funroll-loops          # Desenrollar loops (beneficia NEON)
        -fvectorize             # Vectorización automática (NEON)
        -fomit-frame-pointer    # Liberar registro extra
        -fno-stack-protector    # Quitar stack canary (release only)
    )
    string(JOIN " " K710_FLAGS_STR \${K710_C_FLAGS})

    # Aplicar a C y C++ — FORCE para sobreescribir cualquier flag previo
    set(CMAKE_C_FLAGS   "\${CMAKE_C_FLAGS} \${K710_FLAGS_STR}"   CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS "\${CMAKE_CXX_FLAGS} \${K710_FLAGS_STR}" CACHE STRING "" FORCE)

    # ── Deshabilitar dotprod EXPLÍCITAMENTE ────────────────────────────────
    # El compilador NDK *soporta* el flag aunque el target no lo tenga.
    # GGML puede habilitarlo si no lo forzamos OFF. Resultado: SIGILL en A73.
    set(GGML_DOTPROD        OFF CACHE BOOL "A73 no tiene dotprod" FORCE)
    set(GGML_ARM_DOTPROD    OFF CACHE BOOL "" FORCE)
    # Variantes según versión de llama.cpp
    set(GGML_USE_LLAMAFILE  OFF CACHE BOOL "" FORCE)

    # ── Habilitar NEON explícitamente ──────────────────────────────────────
    # A73 tiene NEON 128-bit. GGML lo detecta en aarch64 pero es mejor forzarlo.
    set(GGML_NEON ON CACHE BOOL "A73 tiene NEON" FORCE)

    # ── Deshabilitar backends no disponibles en Kirin 710 ──────────────────
    set(GGML_METAL  OFF CACHE BOOL "" FORCE)  # Solo iOS
    set(GGML_CUDA   OFF CACHE BOOL "" FORCE)  # No hay CUDA
    # OpenCL y Vulkan: intentar vía force_device en runtime, no en compile time
    # (el .so genérico ya los incluye como backends opcionales)
endif()
# ── Fin Kirin 710 ───────────────────────────────────────────────────────────
`

function patchCMakeLists(projectRoot) {
    // Buscar CMakeLists en cui-llama.rn
    const candidates = [
        path.join(projectRoot, 'node_modules', 'cui-llama.rn', 'android', 'CMakeLists.txt'),
        path.join(projectRoot, 'node_modules', 'llama.rn', 'android', 'CMakeLists.txt'),
    ]

    const cmakePath = candidates.find(fs.existsSync)

    if (!cmakePath) {
        console.warn('\n[kirin710] ⚠ CMakeLists.txt no encontrado en:')
        candidates.forEach(p => console.warn('  -', p))
        console.warn('[kirin710] Asegurate de haber corrido npm install\n')
        return false
    }

    let content = fs.readFileSync(cmakePath, 'utf8')

    // Idempotente: no aplicar dos veces
    if (content.includes(MARKER)) {
        console.log('[kirin710] ✓ CMakeLists.txt ya estaba parcheado')
        return true
    }

    // Insertar después de project() o cmake_minimum_required()
    // Necesita estar temprano para que las variables CACHE funcionen
    const insertionPatterns = [
        /project\s*\([^)]+\)\s*/,
        /cmake_minimum_required\s*\([^)]+\)\s*/,
    ]

    let inserted = false
    for (const pattern of insertionPatterns) {
        const match = content.match(pattern)
        if (match) {
            content = content.replace(match[0], match[0] + K710_CMAKE_BLOCK)
            inserted = true
            break
        }
    }

    if (!inserted) {
        // Fallback: insertar al principio
        content = K710_CMAKE_BLOCK + '\n' + content
    }

    fs.writeFileSync(cmakePath, content)
    console.log('\n[kirin710] ✓ CMakeLists.txt parcheado exitosamente')
    console.log('[kirin710]   Path:', cmakePath)
    console.log('[kirin710]   Flags: -march=armv8-a -mtune=cortex-a73 -O3 -ffast-math')
    console.log('[kirin710]   dotprod: DESHABILITADO (previene SIGILL en A73)\n')
    return true
}

module.exports = function withKirin710(config, options = {}) {
    const { enabled = true } = options

    if (!enabled) {
        console.log('[kirin710] Plugin deshabilitado por options.enabled=false')
        return config
    }

    return withDangerousMod(config, [
        'android',
        async (c) => {
            patchCMakeLists(c.modRequest.projectRoot)
            return c
        },
    ])
}

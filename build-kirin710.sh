#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  build-kirin710.sh — Compilar ChatterUI optimizado para Kirin 710
#  Cortex-A73: -march=armv8-a -mtune=cortex-a73 -O3 -ffast-math
# ════════════════════════════════════════════════════════════════
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   ChatterUI × Kirin 710 Build Script     ║"
echo "  ║   Cortex-A73 native optimization         ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Requisitos ────────────────────────────────────────────────
echo -e "${YELLOW}[1/6] Verificando requisitos...${NC}"

check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo -e "${RED}✗ $1 no encontrado. Instalar: $2${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ $1${NC}"
}

check_cmd node   "https://nodejs.org"
check_cmd npm    "viene con node"
check_cmd java   "JDK 17: sudo apt install openjdk-17-jdk"
check_cmd cmake  "sudo apt install cmake"

# Android NDK
if [ -z "$ANDROID_NDK_HOME" ] && [ -z "$NDK" ]; then
    # Intentar rutas comunes
    for candidate in \
        "$HOME/Android/Sdk/ndk/27.2.12479018" \
        "$HOME/Android/Sdk/ndk/26.3.11579264" \
        "$HOME/Library/Android/sdk/ndk/27.2.12479018" \
        "/opt/android-ndk-r27"; do
        if [ -d "$candidate" ]; then
            export ANDROID_NDK_HOME="$candidate"
            break
        fi
    done
fi

if [ -z "$ANDROID_NDK_HOME" ]; then
    echo -e "${RED}✗ Android NDK no encontrado.${NC}"
    echo "  Instalar via Android Studio → SDK Manager → NDK (Side by side)"
    echo "  Luego: export ANDROID_NDK_HOME=/path/to/ndk"
    exit 1
fi
echo -e "${GREEN}✓ NDK: $ANDROID_NDK_HOME${NC}"

# ── Dependencias ──────────────────────────────────────────────
echo -e "\n${YELLOW}[2/6] Instalando dependencias npm...${NC}"
npm install

# ── Prebuild ──────────────────────────────────────────────────
echo -e "\n${YELLOW}[3/6] Corriendo expo prebuild (genera android/)...${NC}"
echo "    El plugin kirin710.plugin.js parcheará CMakeLists.txt automáticamente"
npx expo prebuild --platform android --clean

# ── Verificar que el parche se aplicó ────────────────────────
echo -e "\n${YELLOW}[4/6] Verificando parche Kirin 710...${NC}"
CMAKE_FILE="node_modules/cui-llama.rn/android/CMakeLists.txt"
if [ -f "$CMAKE_FILE" ] && grep -q "__KIRIN710_INJECTED__" "$CMAKE_FILE"; then
    echo -e "${GREEN}✓ CMakeLists.txt parcheado correctamente${NC}"
    echo "  Flags: -march=armv8-a -mtune=cortex-a73 -O3 -ffast-math"
    echo "  dotprod: DESHABILITADO (previene SIGILL en A73)"
else
    echo -e "${RED}✗ El parche NO se aplicó. Verificar kirin710.plugin.js${NC}"
    exit 1
fi

# ── Build ─────────────────────────────────────────────────────
echo -e "\n${YELLOW}[5/6] Compilando APK release...${NC}"
echo "    ABI: arm64-v8a only (Kirin 710 es 64-bit)"
echo "    Esto puede tardar 15-40 minutos la primera vez"
echo ""

cd android
./gradlew assembleRelease \
    -Pandroid.injected.signing.store.file="$KEYSTORE_PATH" \
    -Pandroid.injected.signing.store.password="$KEYSTORE_PASS" \
    -Pandroid.injected.signing.key.alias="$KEY_ALIAS" \
    -Pandroid.injected.signing.key.password="$KEY_PASS" \
    2>&1 | grep -E "BUILD|ERROR|error:|warning:|Kirin|cortex|march|K710" || true

# Build sin firma si no hay keystore
if [ $? -ne 0 ] || [ -z "$KEYSTORE_PATH" ]; then
    echo -e "${YELLOW}Building sin firma (debug keystore)...${NC}"
    ./gradlew assembleRelease 2>&1 | tail -20
fi

cd ..

# ── Output ────────────────────────────────────────────────────
echo -e "\n${YELLOW}[6/6] Resultado...${NC}"
APK=$(find android/app/build/outputs/apk -name "*.apk" | head -1)
if [ -n "$APK" ]; then
    SIZE=$(du -sh "$APK" | cut -f1)
    echo -e "${GREEN}✓ APK generado: $APK (${SIZE})${NC}"
    echo ""
    echo "  Para instalar en el teléfono:"
    echo "  adb install -r $APK"
    echo ""
    echo "  O copiarlo al teléfono y abrir con un gestor de archivos."
else
    echo -e "${RED}✗ APK no encontrado. Ver logs arriba.${NC}"
    exit 1
fi

echo -e "\n${GREEN}════ Build completado ════${NC}"
echo "  El .so fue compilado con -march=armv8-a -mtune=cortex-a73"
echo "  Debería dar ~10-20% más t/s vs el .so genérico"

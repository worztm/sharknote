#!/bin/bash
# Sharknote Android dev loop: install to the connected phone + launch + show crash logs.
# Usage:
#   ./dev.sh            install + launch + tail crash logs
#   ./dev.sh logs       just tail crash logs
#   ./dev.sh clean      uninstall the app from the phone (wipes its data)
SDK="C:/Users/masud/AppData/Local/Android/Sdk"
ADB="$SDK/platform-tools/adb.exe"
PKG="app.sharknote.mobile"

case "$1" in
  logs)
    echo "── crash log tail (Ctrl+C to stop) ──"
    "$ADB" logcat AndroidRuntime:E Sharknote:D "*:S"
    ;;
  clean)
    "$ADB" uninstall "$PKG"
    ;;
  *)
    "$ADB" get-state >/dev/null 2>&1 || { echo "No device. Plug in USB (or adb connect), check: \"$ADB\" devices"; exit 1; }
    echo "── device: $("$ADB" shell getprop ro.product.model 2>/dev/null | tr -d '\r') ──"
    ./gradlew installRelease -q || exit 1
    "$ADB" shell am force-stop "$PKG"
    "$ADB" shell am start -n "$PKG/.MainActivity" >/dev/null
    echo "── installed + launched. logs: ./dev.sh logs ──"
    ;;
esac

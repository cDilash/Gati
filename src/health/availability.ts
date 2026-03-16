import { NativeModules } from "react-native";

let _healthKit: any = null;
let _constants: any = null;
let _checked = false;
let _available = false;

export function isHealthKitAvailable(): boolean {
  if (_checked) return _available;
  _checked = true;
  try {
    // The JS wrapper's default export is broken under RN 0.83 new architecture.
    // Access the native module directly from NativeModules instead.
    const native = NativeModules.AppleHealthKit;
    if (native) {
      _healthKit = native;
      // Constants (Permissions, Activities, etc.) are exported by the JS wrapper
      try {
        _constants = require("react-native-health").Constants;
      } catch {}
      _available = true;
    }
  } catch (e) {
    _available = false;
  }
  return _available;
}

export function getHealthKit(): any | null {
  if (!_checked) isHealthKitAvailable();
  return _available ? _healthKit : null;
}

export function getHealthKitConstants(): any | null {
  if (!_checked) isHealthKitAvailable();
  return _constants;
}

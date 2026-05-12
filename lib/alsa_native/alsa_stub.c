/*
 * alsa_stub.c — non-Linux build stub.
 *
 * binding.gyp falls back to compiling this file on Windows/macOS so the
 * addon target still produces a loadable .node module (which exports an
 * empty `available: false` object). The JS wrapper checks `available`
 * before calling anything else, so consumers always get a safe answer.
 *
 * libasound is Linux-only — there's no equivalent we'd want to fall
 * back to on the other platforms. Their Chromium-backed audio path
 * is fine and already covered by enumerateDevices().
 */
#include <node_api.h>

static napi_value Init(napi_env env, napi_value exports) {
  napi_value available;
  napi_get_boolean(env, false, &available);
  napi_set_named_property(env, exports, "available", available);

  napi_value platform;
  napi_create_string_utf8(env, "non-linux", NAPI_AUTO_LENGTH, &platform);
  napi_set_named_property(env, exports, "platform", platform);
  return exports;
}

NAPI_MODULE(alsa_native, Init)

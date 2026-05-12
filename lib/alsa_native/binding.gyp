{
  "targets": [
    {
      "target_name": "alsa_native",
      "conditions": [
        ["OS==\"linux\"", {
          "sources": ["alsa_addon.c"],
          "libraries": ["-lasound", "-lpthread"],
          "cflags": ["-std=c11", "-O2", "-Wall", "-Wextra", "-Wno-unused-parameter"]
        }],
        ["OS!=\"linux\"", {
          "sources": ["alsa_stub.c"],
          "cflags": ["-O2"]
        }]
      ]
    }
  ]
}

# Blender bridge — install and round-trip proof

Establishes the asset pipeline's DCC stage, and the evidence that it works.
Recorded per the requirement that no anatomy is touched until four operations
are proven.

Branch: `visual/anatomy-atlas-v2`.

---

## 1. Versions and placement

| Item | Value |
|---|---|
| Blender | **4.5.14 LTS** (build date 2026-09-15, build time 01:33:49) |
| Platform | Windows x64, **full GUI** |
| Install path | `C:\Users\lqy\Apps\Blender\blender-4.5.14-windows-x64\blender.exe` |
| Distribution | official portable **ZIP** (`blender-4.5.14-windows-x64.zip`, 398,661,046 bytes) |
| MCP package | **mcp-for-blender 2.1.3** (PyPI; current name — legacy `blender-mcp` 2.0.0 is a rename shim) |
| Add-on | **MCP for Blender, `bl_info` version (1, 8)** |
| Protocol version | **13** |
| Socket port | **9876** |
| Socket bind | **127.0.0.1 only** — confirmed, no other listener |
| Telemetry | **off** — `consent: false` verified through the bridge |
| Add-on path | `%APPDATA%\Blender Foundation\Blender\4.5\scripts\addons\addon.py` |

### Why the ZIP and not the MSI

The MSI failed with `Error 1303` — *insufficient privileges to access
`C:\Program Files\Blender Foundation`* — because this session is not elevated.
The ZIP is the same official 4.5.14 full-GUI build, unpacked rather than
registered. Nothing differs about the application. What is given up: a Start Menu
entry and file associations. What is gained: no UAC, no machine-wide change, and
removal by deleting one folder.

WSL Blender was **not** installed, per the explicit instruction. This is an
intentional exception to the WSL-only runtime rule: Blender is a graphical DCC
application, not a fallback for the coding stack.

---

## 2. Constraints discovered, and what they cost

### 2.1 The bridge requires a GUI, by design

`addon.py:1266`:

```python
def start(self):
    if bpy.app.background:
        print("BlenderMCP: cannot start server in background mode (blender -b) "
              "- commands would never execute\n"
              "BlenderMCP: run Blender with a GUI, or use a virtual display: xvfb-run -a blender")
        return
```

This is not a limitation to work around. The add-on queues commands and drains
them from `bpy.app.timers` on Blender's main thread; under `blender -b` the
timers never fire, so even a bound socket would never execute anything. Running
`blender --background` produces `server_running=False` and a refused connection.

Consequence: **every interactive pipeline step needs the GUI Blender running.**
This is consistent with the approved decision, and the later headless export path
is a separate piece of work — `bpy.ops.export_scene.gltf` already works headless
and needs no socket.

### 2.2 The bundled `setup` installer is unreliable on a non-UTF-8 console

Two independent defects, both hit:

1. `UnicodeEncodeError: 'gbk' codec can't encode character '\u2713'` — it prints
   ✓/✗ and this machine's console codepage is GBK. Worked around with
   `PYTHONIOENCODING=utf-8`.
2. `TypeError: can only concatenate str (not "NoneType") to str` at
   `setup_cli.py:468` — `proc.stdout + proc.stderr` when a subprocess produced no
   captured output. This is a genuine bug in 2.1.3, hit while it shelled out to
   the Claude Code CLI.

So the add-on and the MCP server were installed directly instead: `addon.py`
fetched from the project repository into the user add-ons directory, enabled and
persisted via `bpy.ops.preferences.addon_enable` +
`bpy.ops.wm.save_userpref()`, and the opencode MCP entry written by hand against
the documented schema. Each step was verified individually.

`setup` would also have written MCP entries into five other clients (Claude Code,
Cursor, VS Code, Windsurf). It was **not** used for that. Only opencode was
configured; the other clients' config files remain absent, verified after the
fact.

### 2.3 `execute_code` returns captured stdout

`addon.py:2238` does `exec(code, namespace)` and returns the redirected stdout
as the result. Two consequences, both learned by hitting them:

- a top-level `return` is a `SyntaxError` — the code is not wrapped in a function;
- to get a value back, `print()` it.

---

## 3. Round-trip evidence

Client: an external process opening a real TCP socket to `127.0.0.1:9876` and
speaking the add-on's JSON protocol — the same path the MCP tools use. Not a
simulated or mocked call.

```
PASS | 1  read scene                (get_scene_info) | status=success objects=['Cube', 'Light', 'Camera']
INFO | addon | name=MCP for Blender addon_version=[1, 8] protocol_version=13 capabilities=13
PASS | 1b read addon info           (get_addon_info) | addon_version=[1, 8] protocol_version=13
PASS | 2  create/manipulate object   (execute_code)   | {"name": "ProofCube", "type": "MESH",
        "loc_before": [1.0,2.0,3.0], "loc_after": [4.0,2.0,3.0], "rot_z_deg": 30.0,
        "scale": [1.5,1.5,1.5], "verts": 8, "polys": 6}
PASS | 3  assign/change material     (execute_code)   | {"first_assigned": "ProofMatA",
        "after_change": "ProofMatB", "new_colour_rgba": [0.1,0.1,0.8,1.0], "slots": ["ProofMatB"]}
PASS | 4  export GLB                 (export_scene)   | bytes=3420 magic=b'glTF'
        exported=['Cube','Light','Camera','ProofCube']
PASS | 4b export GLB                 (execute_code -> bpy) | bytes=3420 magic=b'glTF'

TOTAL=6 PASSED=6 FAILED=0
PROOF_COMPLETE
```

Each of the four required operations is demonstrated by an observed value change,
not by an absence of error:

| Operation | Evidence |
|---|---|
| read scene | three objects enumerated by name from the live scene |
| create / manipulate | object created, then `location.x` moved 1.0 → 4.0 and read back, with rotation and scale set |
| assign / change material | material A assigned, replaced by material B, base colour read back as `[0.1, 0.1, 0.8, 1.0]`, slot list confirmed |
| export GLB | 3420-byte file whose first four bytes are the `glTF` magic, and the exported object list includes the object created in step 2 — proved both through the add-on's own `export_scene` handler and through `bpy.ops.export_scene.gltf` |

### Telemetry and network exposure

```
BEFORE: {"status": "success", "result": {"consent": false}}
SET OFF: {"status": "success", "result": {"consent": false}}
AFTER : {"status": "success", "result": {"consent": false}}
```

Every listening socket owned by the Blender process:

```
LocalAddress LocalPort OwningProcess
------------ --------- -------------
127.0.0.1         9876         41792
```

One listener, loopback only. No `0.0.0.0`, no external interface. The add-on's
default is already `host='localhost'` (`addon.py:1184`), and it was not changed.

---

## 4. opencode wiring

`~/.config/opencode/opencode.jsonc`:

```jsonc
"mcp": {
  "blender": {
    "type": "local",
    "command": ["E:\\APP\\Tools\\uv\\bin\\uvx.exe", "--refresh-package",
                "mcp-for-blender", "mcp-for-blender@2.1.3"],
    "enabled": true,
    "environment": {
      "DISABLE_TELEMETRY": "true",
      "BLENDER_HOST": "localhost",
      "BLENDER_PORT": "9876"
    }
  }
}
```

Validated as parseable with the expected shape. **opencode reads config once at
startup and does not hot-reload**, so the MCP tools become callable after a
restart. Until then the bridge was driven directly over the socket, which is why
the proof above is real evidence rather than a claim about tooling that has not
loaded yet.

The package version is pinned to `2.1.3` in the command so the bridge cannot
silently drift to a new major behaviour, while `--refresh-package` still lets it
see the current index.

---

## 5. Operating notes for the asset pass

- Start GUI Blender and confirm the listener before any scripted step:
  `Get-NetTCPConnection -LocalPort 9876 -State Listen`.
- Import the shoulder OBJ set through `execute_code`, not by opening files in the
  UI, so the pass is scripted and repeatable.
- Presentation materials are authored here and nowhere else. The source ships no
  material library, so this is where the "everything is gray" failure is fixed.
- Export with `export_scene` or `bpy.ops.export_scene.gltf`; both verified.
- A headless export path needs no socket and can be added later without the
  bridge.
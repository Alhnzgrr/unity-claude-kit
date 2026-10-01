---
paths:
  - "**/*.shader"
  - "**/*.hlsl"
  - "**/*.cginc"
  - "**/*.compute"
---

# Shaders

Check the render pipeline before writing a line — it is in the session context
at the top of this conversation. A Built-in shader renders magenta in URP, and
a URP shader does not compile in Built-in.

| Pipeline | Include | Tag |
| --- | --- | --- |
| URP / HDRP | the pipeline's `ShaderLibrary/Core.hlsl` | `"RenderPipeline" = "UniversalPipeline"` |
| Built-in | `UnityCG.cginc` | no RenderPipeline tag |

- **`.cginc` and `UnityCG.cginc` are Built-in.** URP and HDRP use `.hlsl` and
  the SRP ShaderLibrary. Mixing the two is the usual cause of a shader that
  compiles on one machine and not another.
- **`CBUFFER_START(UnityPerMaterial)` must list every material property, in the
  same order, in every pass.** Otherwise the SRP Batcher silently stops
  batching that shader — a performance bug with no error message.
- **A pass needs its `LightMode` tag** (`UniversalForward`, `ShadowCaster`,
  `DepthOnly`) or it is not drawn where you expect. A shader with no
  `ShadowCaster` pass casts no shadows.
- **`#pragma multi_compile` compiles every variant into the build;
  `shader_feature` compiles only what a material uses.** Prefer
  `shader_feature`; a careless `multi_compile` is measured in build minutes and
  megabytes.
- **A `.shadergraph` is a serialized asset,** not text to edit. It is opened in
  the Graph window. Custom HLSL belongs in a Custom Function node pointing at
  an `.hlsl` file, which you may write.
- **Mobile**: half precision where it is enough, avoid `discard` in a fragment
  shader where you can (it defeats early-Z), and watch dependent texture reads.

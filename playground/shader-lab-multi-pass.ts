/**
 * @title ShaderLab Multi Pass
 * @category Material
 */

import {
  AssetType,
  BaseMaterial,
  Camera,
  Logger,
  MeshRenderer,
  PrimitiveMesh,
  Script,
  Shader,
  ShaderData,
  Texture2D,
  Vector3,
  Vector4,
  WebGLEngine
} from "@galacean/engine";
import { ShaderLab } from "@galacean/engine-shader-lab";
import { OrbitControl } from "@galacean/engine-toolkit-controls";
import * as dat from "dat.gui";

const LAYER = 40;

Logger.enable();
const gui = new dat.GUI();
const shaderLab = new ShaderLab();
const loopPassSource = Array.from({ length: LAYER })
  .map((_, index) => {
    const step = (1 / LAYER) * index;
    const u_furOffset = step % 1 === 0 ? step + ".0" : step;
    const renderStateSource =
      index > 0
        ? `
    BlendState = transparentBlendState;
    DepthState = transparentDepthState;
    RenderQueueType = RenderQueueType.Transparent;
    `
        : ``;

    return `
      Pass "${index}" {
        ${renderStateSource}

        mat4 renderer_MVPMat;
        float u_furLength;
        vec4 u_uvTilingOffset;
        vec3 u_gravity;
        float u_gravityIntensity;
        sampler2D u_mainTex;
        sampler2D u_layerTex;

        VertexShader = vert;
        FragmentShader = frag;

        v2f vert(a2v v) {
          v2f o;

          float u_furOffset = ${u_furOffset};
          vec4 position = v.POSITION;
          vec3 direction = mix(v.NORMAL, u_gravity * u_gravityIntensity + v.NORMAL * (1.0 - u_gravityIntensity), u_furOffset);
          position.xyz += direction * u_furLength * u_furOffset;

          gl_Position = renderer_MVPMat * position;

          vec2 uvOffset = u_uvTilingOffset.zw * u_furOffset;
          o.v_uv = v.TEXCOORD_0 + uvOffset * vec2(1.0, 1.0) / u_uvTilingOffset.xy;
          o.v_uv2 = v.TEXCOORD_0 * u_uvTilingOffset.xy + uvOffset;

          return o;
        }

        void frag(v2f i) {
          float u_furOffset = ${u_furOffset};
          vec2 v_uv = i.v_uv;
          vec2 v_uv2 = i.v_uv2;

          vec4 baseColor = texture2D(u_mainTex, v_uv);
          float alpha2 = u_furOffset * u_furOffset;

	    	  float mask = (texture2D(u_layerTex, v_uv2)).r;
	    	  mask = step(alpha2, mask);

          gl_FragColor.rgb = baseColor.rgb;

          gl_FragColor.a = 1.0 - alpha2;
          gl_FragColor.a *= mask;
        }
      }
    `;
  })
  .join("\n");

const furShaderSource = `Shader "fur-unlit" {
  SubShader "Default" {
    BlendState transparentBlendState {
      Enabled = true;
      SourceColorBlendFactor = BlendFactor.SourceAlpha;
      DestinationColorBlendFactor = BlendFactor.OneMinusSourceAlpha;
      SourceAlphaBlendFactor = BlendFactor.One;
      DestinationAlphaBlendFactor = BlendFactor.OneMinusSourceAlpha;
    }

    DepthState transparentDepthState {
      WriteEnabled = false;
    }

    struct a2v {
      vec4 POSITION;
      vec3 NORMAL;
      vec2 TEXCOORD_0;
    }

    struct v2f {
      vec2 v_uv;
      vec2 v_uv2;
    }

    ${loopPassSource}
  }
}`;

class RandomGravityScript extends Script {
  shaderData: ShaderData;
  progress = 0;
  onUpdate(deltaTime: number) {
    const progress = 0.5 + Math.cos((this.progress = this.progress + deltaTime * 2)) / 2;
    this.shaderData.setFloat("u_gravityIntensity", progress);
  }
}

WebGLEngine.create({ canvas: "canvas", shaderLab }).then((engine) => {
  engine.canvas.resizeByClientSize();

  const furShader = Shader.create(furShaderSource);
  const scene = engine.sceneManager.activeScene;
  const rootEntity = scene.createRootEntity();

  // camera
  const cameraEntity = rootEntity.createChild("cameraNode");
  cameraEntity.transform.setPosition(0, 0, 5);
  cameraEntity.addComponent(Camera);
  cameraEntity.addComponent(OrbitControl);

  engine.resourceManager
    .load([
      {
        type: AssetType.Texture2D,
        url: "https://mdn.alipayobjects.com/huamei_dmxymu/afts/img/A*R75iTZlbVfgAAAAAAAAAAAAADuuHAQ/original"
      },
      {
        type: AssetType.Texture2D,
        url: "https://mdn.alipayobjects.com/huamei_dmxymu/afts/img/A*t1s4T7h_1OQAAAAAAAAAAAAADuuHAQ/original"
      }
    ])
    .then((res) => {
      const layerTexture = res[0] as Texture2D;
      const baseTexture = res[1] as Texture2D;

      // create sphere
      const entity = rootEntity.createChild("sphere");
      const renderer = entity.addComponent(MeshRenderer);
      renderer.mesh = PrimitiveMesh.createSphere(engine, 0.5, 16);

      const material = new BaseMaterial(engine, furShader);
      renderer.setMaterial(material);

      const shaderData = material.shaderData;

      shaderData.setTexture("u_mainTex", baseTexture);
      shaderData.setTexture("u_layerTex", layerTexture);

      shaderData.setFloat("u_furLength", 0.5);
      shaderData.setVector4("u_uvTilingOffset", new Vector4(5, 5, 0.5, 0.5));
      shaderData.setVector3("u_gravity", new Vector3(0, 0, 0));
      shaderData.setFloat("u_gravityIntensity", 0);

      const randomGravityScript = entity.addComponent(RandomGravityScript);
      randomGravityScript.shaderData = shaderData;

      const debugInfo = {
        u_furLength: 0.5,
        uvScale: 5,
        uvOffset: 0.5,
        enable: () => {
          randomGravityScript.enabled = !randomGravityScript.enabled;
          shaderData.setFloat("u_gravityIntensity", 0);
          randomGravityScript.progress = 0;
        }
      };

      gui.add(debugInfo, "u_furLength", 0, 1, 0.01).onChange((v) => {
        shaderData.setFloat("u_furLength", v);
      });
      gui.add(debugInfo, "uvScale", 1, 20, 1).onChange((v) => {
        const value = shaderData.getVector4("u_uvTilingOffset");
        value.x = value.y = v;
      });
      gui.add(debugInfo, "uvOffset", -1, 1, 0.01).onChange((v) => {
        const value = shaderData.getVector4("u_uvTilingOffset");
        value.z = value.w = v;
      });
      gui.add(debugInfo, "enable").name("pause/resume");
      engine.run();
    });
});

import type { MobType } from './mobs.js';

export type MobTextures = Record<MobType, WebGLTexture | null>;

/** Fetches /mc/entities/<mob>.png. Missing textures resolve to null (color fallback). */
export async function loadMobAssets(gl: WebGL2RenderingContext): Promise<MobTextures> {
  const out: MobTextures = { pig: null, cow: null, zombie: null, skeleton: null };
  const flipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
  const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
  const types: MobType[] = ['pig', 'cow', 'zombie', 'skeleton'];
  await Promise.all(types.map(async (type) => {
    try {
      const res = await fetch(`/mc/entities/${type}.png`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob(), {
        premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none',
      });
      const tex = gl.createTexture();
      if (!tex) throw new Error('createTexture failed');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      bmp.close();
      out[type] = tex;
    } catch (err) {
      console.warn(`[mobs] texture ${type} unavailable, using fallback color`, err);
    }
  }));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
  return out;
}

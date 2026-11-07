export interface AnimInfo {
  id: number;
  key: string;
  layer: number;
  frames: number;
  frametime: number;
  frameList: (number | { index: number; time: number })[] | null;
  interpolate: boolean;
}

export interface TextureInfo {
  key: string;
  path: string;
  framePaths: string[];
  w: number;
  h: number;
  animated: boolean;
  animation: null | {
    frametime: number;
    frames: number;
    frameList: (number | { index: number; time: number })[] | null;
    interpolate: boolean;
    width: number;
  };
  frames: number;
  animId: number;
  arrayLayer: number;
}

export interface QuadJson {
  p: number[];
  uv: number[];
  t: string;
  tr?: boolean;
  d: number;
  c: number;
  ti: number;
  s: boolean;
  ao: boolean;
}

export interface BlockFlags {
  opaque: boolean;
  solid: boolean;
  render: 'opaque' | 'cutout' | 'translucent';
  lightOpacity: number;
  light: number;
  tint: 'none' | 'grass' | 'foliage' | 'water' | 'fixed';
  tintColor: string | null;
  noAO: boolean;
  cullSelf: boolean;
  liquid: boolean;
  emissive: boolean;
  hardness: number;
  sound: string;
}

export interface BlockJson {
  id: number;
  name: string;
  state: string;
  guiLight: string;
  custom: null | 'water' | 'lava';
  flags: BlockFlags;
  quads: QuadJson[];
}

export interface SoundRec {
  path: string;
  volume: number;
  pitch: number;
  weight: number;
}

export interface Manifest {
  generatedAt: string;
  version: string;
  audio?: { events: Record<string, SoundRec[]> };
  textures: Record<string, TextureInfo>;
  layerCount: number;
  animTextures: AnimInfo[];
  blocks: BlockJson[];
  gui: Record<string, string>;
  environment: Record<string, string>;
  colormap: Record<string, string>;
  font: Record<string, string>;
}

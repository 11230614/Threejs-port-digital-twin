import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface AssetLoadOptions { onProgress?: (event: ProgressEvent<EventTarget>) => void }
export interface AssetLoaderLike { load(url: string, options?: AssetLoadOptions): Promise<GLTF> }

export class AssetLoader implements AssetLoaderLike {
  constructor(private readonly loader: GLTFLoader = new GLTFLoader()) {}

  load(url: string, { onProgress }: AssetLoadOptions = {}): Promise<GLTF> {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, onProgress, reject);
    });
  }
}

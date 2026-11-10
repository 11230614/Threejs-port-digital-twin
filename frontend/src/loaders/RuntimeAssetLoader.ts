import type { WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { AssetLoader } from "../assets/AssetLoader";

export interface RuntimeAssetLoader {
  assetLoader: AssetLoader;
  ktx2Loader: KTX2Loader;
  dispose(): void;
}

export function createRuntimeAssetLoader(
  renderer: WebGLRenderer,
  transcoderPath = `${import.meta.env.BASE_URL}basis/`,
): RuntimeAssetLoader {
  const ktx2Loader = new KTX2Loader()
    .setTranscoderPath(transcoderPath)
    .detectSupport(renderer);
  const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2Loader);
  let disposed = false;

  return {
    assetLoader: new AssetLoader(gltfLoader),
    ktx2Loader,
    dispose() {
      if (disposed) return;
      disposed = true;
      ktx2Loader.dispose();
    },
  };
}

/// <reference types="vite/client" />

declare module "*.glb?url" {
  const url: string;
  export default url;
}

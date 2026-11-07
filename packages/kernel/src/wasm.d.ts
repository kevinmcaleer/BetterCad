declare module "*.wasm";
declare module "*?url" {
  const url: string;
  export default url;
}

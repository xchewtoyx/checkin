// Vite `?raw` imports resolve to the file's contents as a string at
// transform time, so they work inside the workers test pool (no fs needed).
declare module "*.md?raw" {
  const content: string;
  export default content;
}

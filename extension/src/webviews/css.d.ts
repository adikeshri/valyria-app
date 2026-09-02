// esbuild turns `import "./x.css"` into a sibling stylesheet; tsc just needs
// the import to resolve.
declare module "*.css";

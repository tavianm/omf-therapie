import { renderers } from './renderers.mjs';
import { s as serverEntrypointModule } from './chunks/_@astrojs-ssr-adapter_CvSoi7hX.mjs';
import { manifest } from './manifest_OZ0T79rH.mjs';
import { createExports } from '@astrojs/netlify/ssr-function.js';

const serverIslandMap = new Map();;

const _page0 = () => import('./pages/404.astro.mjs');
const _page1 = () => import('./pages/a-propos.astro.mjs');
const _page2 = () => import('./pages/accessibilite.astro.mjs');
const _page3 = () => import('./pages/blog/_slug_.astro.mjs');
const _page4 = () => import('./pages/blog.astro.mjs');
const _page5 = () => import('./pages/contact.astro.mjs');
const _page6 = () => import('./pages/services/therapie-de-couple.astro.mjs');
const _page7 = () => import('./pages/services/therapie-familiale.astro.mjs');
const _page8 = () => import('./pages/services/therapie-individuelle.astro.mjs');
const _page9 = () => import('./pages/services/troubles-alimentaires.astro.mjs');
const _page10 = () => import('./pages/index.astro.mjs');
const pageMap = new Map([
    ["src/pages/404.astro", _page0],
    ["src/pages/a-propos.astro", _page1],
    ["src/pages/accessibilite.astro", _page2],
    ["src/pages/blog/[slug].astro", _page3],
    ["src/pages/blog/index.astro", _page4],
    ["src/pages/contact.astro", _page5],
    ["src/pages/services/therapie-de-couple.astro", _page6],
    ["src/pages/services/therapie-familiale.astro", _page7],
    ["src/pages/services/therapie-individuelle.astro", _page8],
    ["src/pages/services/troubles-alimentaires.astro", _page9],
    ["src/pages/index.astro", _page10]
]);

const _manifest = Object.assign(manifest, {
    pageMap,
    serverIslandMap,
    renderers,
    actions: () => import('./noop-entrypoint.mjs'),
    middleware: () => import('./_noop-middleware.mjs')
});
const _args = {
    "middlewareSecret": "2fc6721f-8331-48df-8c0e-05c0e4b6fbf5"
};
const _exports = createExports(_manifest, _args);
const __astrojsSsrVirtualEntry = _exports.default;
const _start = 'start';
if (Object.prototype.hasOwnProperty.call(serverEntrypointModule, _start)) {
	serverEntrypointModule[_start](_manifest, _args);
}

export { __astrojsSsrVirtualEntry as default, pageMap };

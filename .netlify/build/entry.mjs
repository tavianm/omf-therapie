import { renderers } from './renderers.mjs';
import { s as serverEntrypointModule } from './chunks/_@astrojs-ssr-adapter_CvSoi7hX.mjs';
import { manifest } from './manifest_B0J1vbUa.mjs';
import { createExports } from '@astrojs/netlify/ssr-function.js';

const serverIslandMap = new Map();;

const _page0 = () => import('./pages/a-propos.astro.mjs');
const _page1 = () => import('./pages/accessibilite.astro.mjs');
const _page2 = () => import('./pages/blog/_slug_.astro.mjs');
const _page3 = () => import('./pages/blog.astro.mjs');
const _page4 = () => import('./pages/contact.astro.mjs');
const _page5 = () => import('./pages/services/therapie-de-couple.astro.mjs');
const _page6 = () => import('./pages/services/therapie-familiale.astro.mjs');
const _page7 = () => import('./pages/services/therapie-individuelle.astro.mjs');
const _page8 = () => import('./pages/services/troubles-alimentaires.astro.mjs');
const _page9 = () => import('./pages/index.astro.mjs');
const pageMap = new Map([
    ["src/pages/a-propos.astro", _page0],
    ["src/pages/accessibilite.astro", _page1],
    ["src/pages/blog/[slug].astro", _page2],
    ["src/pages/blog/index.astro", _page3],
    ["src/pages/contact.astro", _page4],
    ["src/pages/services/therapie-de-couple.astro", _page5],
    ["src/pages/services/therapie-familiale.astro", _page6],
    ["src/pages/services/therapie-individuelle.astro", _page7],
    ["src/pages/services/troubles-alimentaires.astro", _page8],
    ["src/pages/index.astro", _page9]
]);

const _manifest = Object.assign(manifest, {
    pageMap,
    serverIslandMap,
    renderers,
    actions: () => import('./noop-entrypoint.mjs'),
    middleware: () => import('./_noop-middleware.mjs')
});
const _args = {
    "middlewareSecret": "f9b11016-4382-4b8d-aa07-8ab297122db1"
};
const _exports = createExports(_manifest, _args);
const __astrojsSsrVirtualEntry = _exports.default;
const _start = 'start';
if (Object.prototype.hasOwnProperty.call(serverEntrypointModule, _start)) {
	serverEntrypointModule[_start](_manifest, _args);
}

export { __astrojsSsrVirtualEntry as default, pageMap };

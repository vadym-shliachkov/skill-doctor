import { breadcrumb, overviewView } from './views.mjs';
import { mermaidForView, mermaidForMap } from './render-mermaid.mjs';

export const safeName = (id) => id.replace(/[^A-Za-z0-9._-]+/g, '_');

// A chart with an overview gets it as one more diagram, listed first: it is what most readers of the board want.
export function figjamDiagrams(model, views) {
  return views
    .filter((v) => v.kind === 'map' || (v.kind !== 'index' && v.nodes.length))
    .flatMap((v) => {
      const name = breadcrumb(views, v.id).join(' / ');
      const ov = overviewView(v);
      return [
        ...(ov ? [{ view: v.id, layer: 'overview', name: `${name} · overview`, file: `figjam/${safeName(v.id)}.overview.mmd`, mermaid: mermaidForView(model, ov, { styles: false }) }] : []),
        { view: v.id, name, file: `figjam/${safeName(v.id)}.mmd`, mermaid: v.kind === 'map' ? mermaidForMap(model, v, { styles: false }) : mermaidForView(model, v, { styles: false }) },
      ];
    });
}

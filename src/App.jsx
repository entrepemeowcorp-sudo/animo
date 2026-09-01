import React from 'react';
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno';
import { Toolbar } from 'polotno/toolbar/toolbar';
import { ZoomButtons } from 'polotno/toolbar/zoom-buttons';
import { SidePanel } from 'polotno/side-panel';
import { Workspace } from 'polotno/canvas/workspace';
import { PagesTimeline } from 'polotno/pages-timeline';
import { createStore } from 'polotno/model/store';
import 'polotno/ui.css';

// Consigue tu clave gratuita en https://polotno.com/cabinet
const store = createStore({
  key: import.meta.env.VITE_POLOTNO_KEY,
  showCredit: true, // en el plan gratuito hay que dejar visible el crédito a Polotno
});

// Un mes = una página. Doce páginas = el calendario completo.
store.addPage();

// --- Ejemplo: foto recortada en forma de corazón ---
// clipSrc acepta una ruta SVG y recorta la imagen a esa forma, dejando la
// máscara y la foto editables por separado. Esto sustituye directamente al
// truco de clip-path que usaba el prototipo en HTML/CSS.
const HEART_PATH =
  'M50 85 C10 60 0 35 20 15 C35 0 50 10 50 25 C50 10 65 0 80 15 C100 35 90 60 50 85 Z';

function addHeartPhoto(url) {
  const page = store.activePage;
  if (!page) return;
  page.addElement({
    type: 'image',
    src: url,
    x: 60,
    y: 60,
    width: 220,
    height: 220,
    clipSrc:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="' +
          HEART_PATH +
          '"/></svg>'
      ),
  });
}

// --- Aplicar el estilo del mes actual a los otros once ---
// Esto NO viene de fábrica en Polotno: es lógica de vuestra app, recorriendo
// store.pages y copiando solo las propiedades de diseño que os interesen,
// sin tocar la foto ni el texto propio de cada mes.
function applyStyleToAllPages() {
  const current = store.activePage;
  if (!current) return;
  const confirmed = window.confirm(
    '¿Aplicar el estilo de este mes a los otros once? No se tocarán las fotos ni los textos.'
  );
  if (!confirmed) return;
  store.pages.forEach((p) => {
    if (p.id === current.id) return;
    p.set({ background: current.background });
    // Aquí iríais copiando también fuente y colores del título, leyendo y
    // escribiendo las propiedades concretas de los elementos de cada página.
  });
}

export const App = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid #ddd',
        }}
      >
        <button onClick={() => addHeartPhoto('https://picsum.photos/400')}>
          Ejemplo: foto en corazón
        </button>
        <button onClick={applyStyleToAllPages}>
          Aplicar estilo a los 12 meses
        </button>
      </div>
      <PolotnoContainer style={{ width: '100%', flex: 1 }}>
        <SidePanelWrap>
          <SidePanel store={store} />
        </SidePanelWrap>
        <WorkspaceWrap>
          <Toolbar store={store} />
          <Workspace store={store} />
          <ZoomButtons store={store} />
          <PagesTimeline store={store} />
        </WorkspaceWrap>
      </PolotnoContainer>
    </div>
  );
};

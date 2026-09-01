import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer, Text as KonvaText, Rect } from 'react-konva';
import useImage from 'use-image';

const STAGE_W = 630;
const STAGE_H = 443; // proporción A5 apaisado (210:148)

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const SHAPES = ['rect', 'rounded', 'oval', 'star', 'heart', 'postit'];

function shapeLabel(id) {
  return { rect: 'Rectangular', rounded: 'Redondeado', oval: 'Óvalo', star: 'Estrella', heart: 'Corazón', postit: 'Post-it' }[id] || id;
}

function makeDefaultPage(i) {
  return {
    photoUrl: null,
    photo: { x: 220, y: 30, width: 360, height: 170, rotation: 0, shape: 'rounded' },
    title: { text: MONTHS[i], x: 30, y: 30, fontSize: 32, color: '#2e2a24' },
    bg: '#fbf7ef',
  };
}

// --- Rutas de recorte (clipFunc) para cada forma de marco ---
// Konva no trae "formas de foto" hechas — clipFunc te da el contexto 2D del
// canvas y tú dibujas la ruta a mano. Aquí están las seis que teníamos en el
// prototipo de HTML, pero ahora usando el motor real en vez de CSS clip-path.
function clipForShape(shape, w, h) {
  return function (ctx) {
    if (shape === 'oval') {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.closePath();
    } else if (shape === 'rounded') {
      const r = Math.min(24, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(w - r, 0);
      ctx.arcTo(w, 0, w, r, r);
      ctx.lineTo(w, h - r);
      ctx.arcTo(w, h, w - r, h, r);
      ctx.lineTo(r, h);
      ctx.arcTo(0, h, 0, h - r, r);
      ctx.lineTo(0, r);
      ctx.arcTo(0, 0, r, 0, r);
      ctx.closePath();
    } else if (shape === 'star') {
      const cx = w / 2, cy = h / 2;
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR * 0.42;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else if (shape === 'heart') {
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.28);
      ctx.bezierCurveTo(w / 2, h * 0.05, w * 0.1, h * 0.05, w * 0.1, h * 0.35);
      ctx.bezierCurveTo(w * 0.1, h * 0.6, w * 0.35, h * 0.78, w / 2, h * 0.98);
      ctx.bezierCurveTo(w * 0.65, h * 0.78, w * 0.9, h * 0.6, w * 0.9, h * 0.35);
      ctx.bezierCurveTo(w * 0.9, h * 0.05, w * 0.6, h * 0.05, w / 2, h * 0.28);
      ctx.closePath();
    } else {
      // rect / postit: sin recorte, el rectángulo entero
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.closePath();
    }
  };
}

// --- Foto: arrastrable, seleccionable y redimensionable/rotable con Transformer ---
// El Transformer es de Konva, probado en producción — esto es justo lo que
// fallaba a mano con CSS en el prototipo anterior (rectangular/redondeado sin
// redimensionar).
function PhotoNode({ page, imageUrl, selected, onSelect, onChange, onRequestUpload }) {
  const [img] = useImage(imageUrl || '', 'anonymous');
  const shapeRef = useRef();
  const trRef = useRef();
  const hasPhoto = !!(imageUrl && img);

  useEffect(() => {
    if (selected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [selected, hasPhoto]);

  function handleTransformEnd() {
    const node = shapeRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onChange({
      ...page.photo,
      x: node.x(),
      y: node.y(),
      width: Math.max(30, node.width() * scaleX),
      height: Math.max(30, node.height() * scaleY),
      rotation: node.rotation(),
    });
  }
  function handleDragEnd(e) {
    onChange({ ...page.photo, x: e.target.x(), y: e.target.y() });
  }
  function handleClick() {
    onSelect();
    if (!hasPhoto && onRequestUpload) onRequestUpload();
  }

  return (
    <React.Fragment>
      {hasPhoto ? (
        <KonvaImage
          ref={shapeRef}
          image={img}
          x={page.photo.x}
          y={page.photo.y}
          width={page.photo.width}
          height={page.photo.height}
          rotation={page.photo.rotation}
          draggable
          onClick={handleClick}
          onTap={handleClick}
          clipFunc={clipForShape(page.photo.shape, page.photo.width, page.photo.height)}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      ) : (
        // Placeholder: se puede mover y colocar ANTES de subir foto, como pedisteis.
        <Rect
          ref={shapeRef}
          x={page.photo.x}
          y={page.photo.y}
          width={page.photo.width}
          height={page.photo.height}
          rotation={page.photo.rotation}
          fill="#ded6c2"
          dash={[8, 6]}
          stroke="#b7ac93"
          draggable
          onClick={handleClick}
          onTap={handleClick}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      )}
      {selected && (
        <Transformer
          ref={trRef}
          rotateEnabled
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 30 || newBox.height < 30) return oldBox;
            return newBox;
          }}
        />
      )}
    </React.Fragment>
  );
}

export const App = () => {
  const [pages, setPages] = useState(() => Array.from({ length: 12 }, (_, i) => makeDefaultPage(i)));
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null); // 'photo' | null
  const fileInputRef = useRef();
  const wrapRef = useRef();
  const [scale, setScale] = useState(1);

  const page = pages[current];

  // Escala el escenario de tamaño fijo (630x443) al ancho real disponible,
  // para que se vea bien tanto en el móvil como en pantalla grande.
  useEffect(() => {
    function updateScale() {
      if (!wrapRef.current) return;
      const w = wrapRef.current.offsetWidth;
      setScale(Math.min(1, w / STAGE_W));
    }
    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  function updatePagePhoto(nextPhoto) {
    setPages((prev) => {
      const copy = [...prev];
      copy[current] = { ...copy[current], photo: nextPhoto };
      return copy;
    });
  }
  function updatePageField(field, value) {
    setPages((prev) => {
      const copy = [...prev];
      copy[current] = { ...copy[current], [field]: value };
      return copy;
    });
  }
  function updateTitleField(field, value) {
    setPages((prev) => {
      const copy = [...prev];
      copy[current] = { ...copy[current], title: { ...copy[current].title, [field]: value } };
      return copy;
    });
  }
  function handleTitleDragEnd(e) {
    const x = e.target.x();
    const y = e.target.y();
    setPages((prev) => {
      const copy = [...prev];
      copy[current] = { ...copy[current], title: { ...copy[current].title, x, y } };
      return copy;
    });
  }
  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => updatePageField('photoUrl', reader.result);
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">Editor de calendarios</span>
        <span className="badge">Konva · sin coste</span>
      </div>

      <div className="workspace">
        <aside className="toolbar">
          <div className="field">
            <p className="label">Foto</p>
            <button className="primary" onClick={() => fileInputRef.current.click()}>
              Subir / cambiar foto
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
          </div>
          <div className="field">
            <p className="label">Forma del marco</p>
            <select value={page.photo.shape} onChange={(e) => updatePagePhoto({ ...page.photo, shape: e.target.value })}>
              {SHAPES.map((s) => (
                <option key={s} value={s}>{shapeLabel(s)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <p className="label">Título del mes</p>
            <input type="text" value={page.title.text} onChange={(e) => updateTitleField('text', e.target.value)} />
          </div>
          <div className="field">
            <p className="label">Tamaño del título</p>
            <input type="range" min="16" max="64" value={page.title.fontSize} onChange={(e) => updateTitleField('fontSize', +e.target.value)} />
          </div>
          <div className="field">
            <p className="label">Color del título</p>
            <input type="color" value={page.title.color} onChange={(e) => updateTitleField('color', e.target.value)} />
          </div>
          <div className="field">
            <p className="label">Fondo de la página</p>
            <input type="color" value={page.bg} onChange={(e) => updatePageField('bg', e.target.value)} />
          </div>
          <p className="hint">
            Toca la foto o el título para seleccionarlos. Arrastra para mover; con la foto
            seleccionada, usa las esquinas para redimensionar o girar.
          </p>
        </aside>

        <div className="canvas-wrap" ref={wrapRef}>
          <div style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
            <div
              style={{
                width: STAGE_W,
                height: STAGE_H,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                boxShadow: '0 10px 30px -12px rgba(46,42,36,.35)',
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              <Stage width={STAGE_W} height={STAGE_H}>
                <Layer>
                  <Rect
                    x={0} y={0} width={STAGE_W} height={STAGE_H}
                    fill={page.bg}
                    onClick={() => setSelected(null)}
                    onTap={() => setSelected(null)}
                  />
                  <PhotoNode
                    page={page}
                    imageUrl={page.photoUrl}
                    selected={selected === 'photo'}
                    onSelect={() => setSelected('photo')}
                    onChange={updatePagePhoto}
                    onRequestUpload={() => fileInputRef.current.click()}
                  />
                  {page.photo.shape === 'postit' && (
                    // Tira de washi tape decorativa — un elemento normal más,
                    // no hay un tipo especial para esto.
                    <Rect
                      x={page.photo.x + page.photo.width * 0.25}
                      y={page.photo.y - 12}
                      width={page.photo.width * 0.5}
                      height={22}
                      fill="rgba(230,180,140,.6)"
                      rotation={-10}
                      listening={false}
                    />
                  )}
                  <KonvaText
                    text={page.title.text}
                    x={page.title.x}
                    y={page.title.y}
                    fontSize={page.title.fontSize}
                    fill={page.title.color}
                    fontFamily="Georgia, serif"
                    draggable
                    onDragEnd={handleTitleDragEnd}
                  />
                </Layer>
              </Stage>
            </div>
          </div>
        </div>
      </div>

      <div className="month-tabs">
        {MONTHS.map((m, i) => (
          <button
            key={m}
            className={'month-tab' + (i === current ? ' active' : '')}
            onClick={() => { setCurrent(i); setSelected(null); }}
          >
            {m.slice(0, 3)}
          </button>
        ))}
      </div>
    </div>
  );
};

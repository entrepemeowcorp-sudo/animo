import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer, Text as KonvaText, Rect, Line, Shape } from 'react-konva';
import useImage from 'use-image';

const STAGE_W = 630;
const STAGE_H = 443; // proporción A5 apaisado (210:148)

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const SHAPES = ['rect', 'rounded', 'oval', 'star', 'heart', 'postit'];

function shapeLabel(id) {
  return { rect: 'Rectangular', rounded: 'Redondeado', oval: 'Óvalo', star: 'Estrella', heart: 'Corazón', postit: 'Post-it' }[id] || id;
}

const YEAR = 2027;
const WEEKDAYS_MON = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const GRID_MARGIN = 24;

function isDark(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

// Dibuja el patrón directamente sobre el contexto del canvas — Konva no trae
// "patrones de fondo" hechos, así que se pintan a mano igual que se haría en
// un <canvas> normal.
function drawPattern(ctx, pattern, color, w, h) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  if (pattern === 'cuadros') {
    const step = 26;
    for (let x = 0; x <= w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  } else if (pattern === 'lunares') {
    const step = 24;
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === 'rayas') {
    const step = 18;
    const diag = w + h;
    for (let offset = -h; offset < diag; offset += step) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + h, h);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function daysInfo(monthIdx) {
  const firstDate = new Date(YEAR, monthIdx, 1);
  const firstWeekday = (firstDate.getDay() + 6) % 7; // 0 = lunes
  const numDays = new Date(YEAR, monthIdx + 1, 0).getDate();
  return { firstWeekday, numDays };
}

// Calcula dónde empieza la cuadrícula según lo que ocupen la foto y el
// título ahora mismo — esto es lo que la hace "adaptativa" de verdad en vez
// de solo desplazarse hacia abajo: recalcula la altura de cada fila para que
// quepa en el espacio que quede, no un bloque de tamaño fijo que se corta.
function computeGridLayout(page) {
  const left = GRID_MARGIN;
  const width = STAGE_W - GRID_MARGIN * 2;
  const photoBottom = page.photo.y + page.photo.height;
  const titleBottom = page.title.y + page.title.fontSize * 1.3;
  let top = Math.max(photoBottom, titleBottom) + 14;
  const bottom = STAGE_H - 14;
  top = Math.min(top, bottom - 70); // deja como mínimo ~70px para la cuadrícula
  const height = Math.max(50, bottom - top);
  return { left, top, width, height };
}

function makeDefaultPage(i) {
  return {
    photoUrl: null,
    photo: { x: 220, y: 30, width: 360, height: 170, rotation: 0, shape: 'rounded' },
    title: { text: MONTHS[i], x: 30, y: 30, fontSize: 32, color: '#2e2a24' },
    bg: '#fbf7ef',
    bgPattern: 'liso', // 'liso' | 'cuadros' | 'lunares' | 'rayas'
    bgPhotoUrl: null,
    gridStyle: 'lines', // 'lines' | 'minimal'
    gridColor: '#2e2a24', // color de los números
    gridLineColor: '#c9c0aa', // color de las líneas separadoras y los días de la semana
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

// --- Cuadrícula de días: centrada de verdad y con su tamaño de fila
// recalculado en cada render según el espacio disponible (computeGridLayout) ---
function CalendarGrid({ monthIdx, page }) {
  const layout = computeGridLayout(page);
  const { firstWeekday, numDays } = daysInfo(monthIdx);
  const cols = 7;
  const totalCells = firstWeekday + numDays;
  const rows = Math.ceil(totalCells / cols);
  const colW = layout.width / cols;
  const headerH = Math.min(18, layout.height * 0.15);
  const bodyTop = layout.top + headerH;
  const bodyHeight = layout.height - headerH;
  const rowH = bodyHeight / rows;

  const weekdayLabels = WEEKDAYS_MON.map((wd, i) => (
    <KonvaText
      key={'wd' + i}
      text={wd}
      x={layout.left + i * colW}
      y={layout.top}
      width={colW}
      align="center"
      fontSize={Math.max(8, headerH * 0.7)}
      fill={page.gridLineColor}
    />
  ));

  const dayNumbers = [];
  for (let d = 1; d <= numDays; d++) {
    const cellIndex = firstWeekday + d - 1;
    const row = Math.floor(cellIndex / cols);
    const col = cellIndex % cols;
    const cellX = layout.left + col * colW;
    const cellY = bodyTop + row * rowH;
    const fontSize = Math.max(8, Math.min(14, rowH * 0.4));
    dayNumbers.push(
      <KonvaText
        key={'d' + d}
        text={String(d)}
        x={cellX}
        y={cellY + rowH / 2 - fontSize / 2} // centrado vertical real dentro de la fila
        width={colW}
        align="center" // centrado horizontal real dentro de la columna
        fontSize={fontSize}
        fill={page.gridColor}
      />
    );
  }

  const separators = [];
  if (page.gridStyle === 'lines') {
    for (let r = 1; r < rows; r++) {
      separators.push(
        <Line
          key={'ln' + r}
          points={[layout.left, bodyTop + r * rowH, layout.left + layout.width, bodyTop + r * rowH]}
          stroke={page.gridLineColor}
          strokeWidth={1}
        />
      );
    }
  }

  return (
    <React.Fragment>
      {separators}
      {weekdayLabels}
      {dayNumbers}
    </React.Fragment>
  );
}

// --- Fondo: si hay foto de fondo, cubre toda la página (como
// background-size:cover); si no, color liso + patrón opcional dibujado a mano ---
function BackgroundLayer({ page, onDeselect }) {
  const [bgImg] = useImage(page.bgPhotoUrl || '', 'anonymous');

  if (page.bgPhotoUrl && bgImg) {
    const scale = Math.max(STAGE_W / bgImg.width, STAGE_H / bgImg.height);
    const w = bgImg.width * scale;
    const h = bgImg.height * scale;
    const x = (STAGE_W - w) / 2;
    const y = (STAGE_H - h) / 2;
    return <KonvaImage image={bgImg} x={x} y={y} width={w} height={h} onClick={onDeselect} onTap={onDeselect} />;
  }

  const patternColor = isDark(page.bg) ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)';

  return (
    <React.Fragment>
      <Rect x={0} y={0} width={STAGE_W} height={STAGE_H} fill={page.bg} onClick={onDeselect} onTap={onDeselect} />
      {page.bgPattern !== 'liso' && (
        <Shape
          listening={false}
          sceneFunc={(ctx) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, STAGE_W, STAGE_H);
            ctx.clip();
            drawPattern(ctx, page.bgPattern, patternColor, STAGE_W, STAGE_H);
            ctx.restore();
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
  const bgFileInputRef = useRef();
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
  function handleBgFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => updatePageField('bgPhotoUrl', reader.result);
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
            <input type="color" value={page.bg} onChange={(e) => updatePageField('bg', e.target.value)} disabled={!!page.bgPhotoUrl} />
            <select
              style={{ marginTop: 8 }}
              value={page.bgPattern}
              onChange={(e) => updatePageField('bgPattern', e.target.value)}
              disabled={!!page.bgPhotoUrl}
            >
              <option value="liso">Liso</option>
              <option value="cuadros">Cuadros</option>
              <option value="lunares">Lunares</option>
              <option value="rayas">Rayas</option>
            </select>
            {page.bgPhotoUrl ? (
              <button className="primary" style={{ marginTop: 8 }} onClick={() => updatePageField('bgPhotoUrl', null)}>
                Quitar foto de fondo
              </button>
            ) : (
              <button className="primary" style={{ marginTop: 8 }} onClick={() => bgFileInputRef.current.click()}>
                Subir foto de fondo
              </button>
            )}
            <input ref={bgFileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgFile} />
          </div>
          <div className="field">
            <p className="label">Estilo de cuadrícula</p>
            <select value={page.gridStyle} onChange={(e) => updatePageField('gridStyle', e.target.value)}>
              <option value="lines">Líneas</option>
              <option value="minimal">Minimal</option>
            </select>
          </div>
          <div className="field">
            <p className="label">Color de los números</p>
            <input type="color" value={page.gridColor} onChange={(e) => updatePageField('gridColor', e.target.value)} />
          </div>
          <div className="field">
            <p className="label">Color de las líneas</p>
            <input type="color" value={page.gridLineColor} onChange={(e) => updatePageField('gridLineColor', e.target.value)} />
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
                  <BackgroundLayer page={page} onDeselect={() => setSelected(null)} />
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
                  <CalendarGrid monthIdx={current} page={page} />
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

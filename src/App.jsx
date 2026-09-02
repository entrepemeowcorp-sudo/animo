import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Group, Image as KonvaImage, Transformer, Text as KonvaText, Rect, Line, Shape } from 'react-konva';
import useImage from 'use-image';

const STAGE_W = 630;
const STAGE_H = 443; // proporción A5 apaisado (210:148)

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const SHAPES = ['rect', 'rounded', 'oval', 'star', 'heart', 'postit', 'diamond', 'hexagon', 'arch', 'cloud'];

function shapeLabel(id) {
  return {
    rect: 'Rectangular', rounded: 'Redondeado', oval: 'Óvalo', star: 'Estrella', heart: 'Corazón',
    postit: 'Post-it', diamond: 'Diamante', hexagon: 'Hexágono', arch: 'Arco', cloud: 'Nube',
  }[id] || id;
}

const YEAR = 2027;
const WEEKDAYS_MON = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const GRID_MARGIN = 24;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Recorte por defecto al subir una foto: la mayor región posible de la
// imagen que cubre el marco sin deformarlo, centrada — pero a partir de ahí
// queda guardada como estado normal, no se vuelve a recalcular sola.
function computeDefaultCrop(imgW, imgH, frameW, frameH) {
  const frameAspect = frameW / frameH;
  const imgAspect = imgW / imgH;
  let cropW, cropH;
  if (imgAspect > frameAspect) {
    cropH = imgH;
    cropW = cropH * frameAspect;
  } else {
    cropW = imgW;
    cropH = cropW / frameAspect;
  }
  return { cropX: (imgW - cropW) / 2, cropY: (imgH - cropH) / 2, cropW, cropH };
}

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

// Mide cuánto ocupa el título de verdad (con su fuente y tamaño reales) para
// poder tratarlo como un obstáculo más a la hora de calcular el hueco libre.
function measureTextWidth(text, fontSize, fontFamily) {
  if (typeof document === 'undefined') return text.length * fontSize * 0.55;
  const canvas = measureTextWidth._canvas || (measureTextWidth._canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

// Layout 2D de verdad: junta la foto y el título en un único rectángulo
// "ocupado", calcula las cuatro franjas libres posibles alrededor de ese
// rectángulo (encima, debajo, izquierda, derecha) y elige la de mayor área.
// Así, si pones la foto a un lado, la cuadrícula ocupa el otro lado entero
// — no se limita a encogerse verticalmente.
function computeGridLayout(page, titleFontFamily) {
  const contentLeft = GRID_MARGIN;
  const contentTop = GRID_MARGIN;
  const contentRight = STAGE_W - GRID_MARGIN;
  const contentBottom = STAGE_H - GRID_MARGIN;

  const titleWidth = measureTextWidth(page.title.text || ' ', page.title.fontSize, titleFontFamily || 'sans-serif');
  const obsLeft = Math.min(page.photo.x, page.title.x);
  const obsTop = Math.min(page.photo.y, page.title.y);
  const obsRight = Math.max(page.photo.x + page.photo.width, page.title.x + titleWidth);
  const obsBottom = Math.max(page.photo.y + page.photo.height, page.title.y + page.title.fontSize * 1.3);

  const gap = 12;
  const raw = [
    { left: contentLeft, top: contentTop, right: contentRight, bottom: obsTop - gap }, // encima
    { left: contentLeft, top: obsBottom + gap, right: contentRight, bottom: contentBottom }, // debajo
    { left: contentLeft, top: contentTop, right: obsLeft - gap, bottom: contentBottom }, // izquierda
    { left: obsRight + gap, top: contentTop, right: contentRight, bottom: contentBottom }, // derecha
  ];
  const candidates = raw
    .map((r) => ({ left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top }))
    .filter((r) => r.width > 70 && r.height > 60);

  if (candidates.length === 0) {
    // No cabe limpiamente en ningún lado: usa la franja de abajo aunque quede apretada.
    const top = Math.min(obsBottom + gap, contentBottom - 60);
    return { left: contentLeft, top, width: contentRight - contentLeft, height: Math.max(50, contentBottom - top) };
  }
  candidates.sort((a, b) => b.width * b.height - a.width * a.height);
  return candidates[0];
}

function makeDefaultPage(i) {
  return {
    photoUrl: null,
    photo: { x: 220, y: 30, width: 360, height: 170, rotation: 0, shape: 'rounded' },
    title: { text: MONTHS[i], x: 30, y: 30, fontSize: 32, color: '#2e2a24', font: 'space' },
    bg: '#fbf7ef',
    bgPattern: 'liso', // 'liso' | 'cuadros' | 'lunares' | 'rayas'
    bgPhotoUrl: null,
    gridStyle: 'lines', // 'lines' | 'minimal' | 'boxed' | 'dots' | 'circles' | 'cards'
    gridBox: null, // null = posición automática; si no, {x,y,width,height} puestos a mano
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
    } else if (shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h / 2);
      ctx.lineTo(w / 2, h);
      ctx.lineTo(0, h / 2);
      ctx.closePath();
    } else if (shape === 'hexagon') {
      const cx = w / 2, cy = h / 2;
      const r = Math.min(w, h) / 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 2;
        const x = cx + r * Math.cos(angle) * (w >= h ? w / Math.min(w, h) : 1);
        const y = cy + r * Math.sin(angle) * (h > w ? h / Math.min(w, h) : 1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else if (shape === 'arch') {
      const r = Math.min(w / 2, h * 0.6);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, r);
      ctx.arc(w / 2, r, r, Math.PI, 0, false);
      ctx.lineTo(w, h);
      ctx.closePath();
    } else if (shape === 'cloud') {
      ctx.beginPath();
      ctx.ellipse(w * 0.24, h * 0.62, w * 0.22, h * 0.36, 0, 0, Math.PI * 2);
      ctx.moveTo(w * 0.62, h * 0.78);
      ctx.ellipse(w * 0.5, h * 0.55, w * 0.26, h * 0.42, 0, 0, Math.PI * 2);
      ctx.moveTo(w * 0.98, h * 0.68);
      ctx.ellipse(w * 0.76, h * 0.64, w * 0.22, h * 0.32, 0, 0, Math.PI * 2);
      ctx.rect(w * 0.1, h * 0.55, w * 0.8, h * 0.42);
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
function PhotoNode({ page, img, selected, onSelect, onChange, onRequestUpload }) {
  const groupRef = useRef();
  const trRef = useRef();
  const hasPhoto = !!(page.photoUrl && img);

  useEffect(() => {
    if (selected && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [selected, hasPhoto]);

  function handleTransformEnd() {
    const node = groupRef.current;
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

  const w = page.photo.width;
  const h = page.photo.height;
  const hasCrop = hasPhoto && page.photo.cropW;

  return (
    <React.Fragment>
      <Group
        ref={groupRef}
        x={page.photo.x}
        y={page.photo.y}
        width={w}
        height={h}
        rotation={page.photo.rotation}
        draggable
        onClick={handleClick}
        onTap={handleClick}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
        clipFunc={hasPhoto ? clipForShape(page.photo.shape, w, h) : undefined}
      >
        {hasPhoto ? (
          <KonvaImage
            image={img}
            x={0} y={0} width={w} height={h}
            crop={hasCrop ? { x: page.photo.cropX, y: page.photo.cropY, width: page.photo.cropW, height: page.photo.cropH } : undefined}
          />
        ) : (
          // Placeholder: se puede mover y colocar ANTES de subir foto, como pedisteis.
          <Rect x={0} y={0} width={w} height={h} fill="#ded6c2" dash={[8, 6]} stroke="#b7ac93" />
        )}
      </Group>
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

// --- Cuadrícula de días: centrada de verdad, con su tamaño recalculado según
// el hueco libre real (computeGridLayout) y varios estilos ---
function CalendarGrid({ monthIdx, page, titleFontFamily, selected, onSelect, onChange }) {
  // Si el usuario ya movió o redimensionó la cuadrícula a mano (page.gridBox),
  // se usa eso. Si no, se sigue calculando sola con computeGridLayout.
  const layout = page.gridBox || computeGridLayout(page, titleFontFamily);
  const groupRef = useRef();
  const trRef = useRef();

  useEffect(() => {
    if (selected && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [selected]);

  function handleDragEnd(e) {
    onChange({ x: e.target.x(), y: e.target.y(), width: layout.width, height: layout.height });
  }
  function handleTransformEnd() {
    const node = groupRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onChange({
      x: node.x(),
      y: node.y(),
      width: Math.max(90, node.width() * scaleX),
      height: Math.max(50, node.height() * scaleY),
    });
  }

  const { firstWeekday, numDays } = daysInfo(monthIdx);
  const cols = 7;
  const totalCells = firstWeekday + numDays;
  const rows = Math.ceil(totalCells / cols);
  const colW = layout.width / cols;
  const headerH = Math.min(18, layout.height * 0.15);
  const bodyTop = headerH; // coordenadas locales al grupo: el propio grupo ya lleva el x/y
  const bodyHeight = layout.height - headerH;
  const rowH = bodyHeight / rows;
  const style = page.gridStyle;

  const weekdayLabels = WEEKDAYS_MON.map((wd, i) => (
    <KonvaText
      key={'wd' + i}
      text={wd}
      x={i * colW}
      y={0}
      width={colW}
      align="center"
      fontSize={Math.max(8, headerH * 0.7)}
      fill={page.gridLineColor}
    />
  ));

  const dayNumbers = [];
  const badges = [];
  for (let d = 1; d <= numDays; d++) {
    const cellIndex = firstWeekday + d - 1;
    const row = Math.floor(cellIndex / cols);
    const col = cellIndex % cols;
    const cellX = col * colW;
    const cellY = bodyTop + row * rowH;
    const cellCenterX = cellX + colW / 2;
    const cellCenterY = cellY + rowH / 2;
    const fontSize = Math.max(8, Math.min(14, rowH * 0.4));

    if (style === 'circles') {
      const radius = Math.min(colW, rowH) * 0.32;
      badges.push(
        <Rect
          key={'badge' + d}
          x={cellCenterX - radius} y={cellCenterY - radius} width={radius * 2} height={radius * 2}
          cornerRadius={radius} stroke={page.gridLineColor} strokeWidth={1}
        />
      );
    }
    if (style === 'cards') {
      badges.push(
        <Rect
          key={'card' + d}
          x={cellX + 2} y={cellY + 2} width={colW - 4} height={rowH - 4}
          cornerRadius={4} fill={page.gridLineColor} opacity={0.12}
        />
      );
    }

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
  if (style === 'lines' || style === 'dots') {
    for (let r = 1; r < rows; r++) {
      separators.push(
        <Line
          key={'ln' + r}
          points={[0, bodyTop + r * rowH, layout.width, bodyTop + r * rowH]}
          stroke={page.gridLineColor}
          strokeWidth={1}
          dash={style === 'dots' ? [1, 5] : undefined}
        />
      );
    }
  }
  if (style === 'boxed') {
    for (let r = 1; r < rows; r++) {
      separators.push(
        <Line key={'hln' + r} points={[0, bodyTop + r * rowH, layout.width, bodyTop + r * rowH]} stroke={page.gridLineColor} strokeWidth={1} />
      );
    }
    for (let c = 1; c < cols; c++) {
      separators.push(
        <Line key={'vln' + c} points={[c * colW, bodyTop, c * colW, bodyTop + bodyHeight]} stroke={page.gridLineColor} strokeWidth={1} />
      );
    }
  }

  return (
    <React.Fragment>
      <Group
        ref={groupRef}
        x={layout.left}
        y={layout.top}
        width={layout.width}
        height={layout.height}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      >
        {/* rectángulo invisible para poder tocar/arrastrar también en los huecos vacíos entre números */}
        <Rect x={0} y={0} width={layout.width} height={layout.height} fill="transparent" />
        {badges}
        {separators}
        {weekdayLabels}
        {dayNumbers}
      </Group>
      {selected && (
        <Transformer
          ref={trRef}
          rotateEnabled={false}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 90 || newBox.height < 50) return oldBox;
            return newBox;
          }}
        />
      )}
    </React.Fragment>
  );
}

// --- Fondo: si hay foto de fondo, cubre toda la página (como
// background-size:cover); si no, color liso + patrón opcional dibujado a mano ---
// --- Ventana de recorte: vista ampliada, con la MISMA máscara de forma que
// el marco real (reutiliza clipForShape), para ajustar con más precisión que
// arrastrando la foto pequeña directamente sobre la página. Trabaja sobre un
// borrador local — no toca el estado real hasta que se confirma. ---
function CropModal({ page, img, onConfirm, onCancel }) {
  const p = page.photo;
  const frameAspect = p.width / p.height;
  const maxDim = 260;
  const previewW = frameAspect >= 1 ? maxDim : maxDim * frameAspect;
  const previewH = frameAspect >= 1 ? maxDim / frameAspect : maxDim;

  const [draft, setDraft] = useState(() => {
    if (p.cropW) {
      return { cropX: p.cropX, cropY: p.cropY, cropW: p.cropW, cropH: p.cropH, baseCropW: p.baseCropW || p.cropW, baseCropH: p.baseCropH || p.cropH, zoom: p.zoom || 1 };
    }
    const def = computeDefaultCrop(img.width, img.height, p.width, p.height);
    return { ...def, baseCropW: def.cropW, baseCropH: def.cropH, zoom: 1 };
  });

  function handleDrag(e) {
    const node = e.target;
    const scaleX = draft.cropW / previewW;
    const scaleY = draft.cropH / previewH;
    const maxX = Math.max(0, img.width - draft.cropW);
    const maxY = Math.max(0, img.height - draft.cropH);
    const cropX = clamp(draft.cropX - node.x() * scaleX, 0, maxX);
    const cropY = clamp(draft.cropY - node.y() * scaleY, 0, maxY);
    setDraft((d) => ({ ...d, cropX, cropY }));
    node.x(0);
    node.y(0);
  }
  function handleZoom(newZoom) {
    const cropW = Math.min(img.width, draft.baseCropW / newZoom);
    const cropH = Math.min(img.height, draft.baseCropH / newZoom);
    const centerX = draft.cropX + draft.cropW / 2;
    const centerY = draft.cropY + draft.cropH / 2;
    const cropX = clamp(centerX - cropW / 2, 0, Math.max(0, img.width - cropW));
    const cropY = clamp(centerY - cropH / 2, 0, Math.max(0, img.height - cropH));
    setDraft({ ...draft, zoom: newZoom, cropW, cropH, cropX, cropY });
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Ajustar recorte</h3>
        <div className="crop-preview-wrap" style={{ width: previewW, height: previewH }}>
          <Stage width={previewW} height={previewH}>
            <Layer>
              <Group width={previewW} height={previewH} clipFunc={clipForShape(p.shape, previewW, previewH)}>
                <KonvaImage
                  image={img}
                  x={0} y={0} width={previewW} height={previewH}
                  crop={{ x: draft.cropX, y: draft.cropY, width: draft.cropW, height: draft.cropH }}
                  draggable
                  onDragMove={handleDrag}
                />
              </Group>
            </Layer>
          </Stage>
        </div>
        <p className="label" style={{ marginTop: 10 }}>Zoom</p>
        <input type="range" min="1" max="3" step="0.05" value={draft.zoom} onChange={(e) => handleZoom(+e.target.value)} />
        <p className="hint">Arrastra la foto dentro del marco para elegir qué parte se ve.</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancelar</button>
          <button
            type="button"
            className="primary"
            onClick={() => onConfirm({ ...p, cropX: draft.cropX, cropY: draft.cropY, cropW: draft.cropW, cropH: draft.cropH, baseCropW: draft.baseCropW, baseCropH: draft.baseCropH, zoom: draft.zoom })}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

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

const PALETTES = [
  { name: 'Pastel', colors: ['#fbe4e4', '#fde2c8', '#fdf3c8', '#e2f0d9', '#d8e8f0', '#e6dcf0'] },
  { name: 'Neón', colors: ['#ff2d55', '#ff9500', '#ffe600', '#39ff14', '#00e5ff', '#d400ff'] },
  { name: 'Metálico', colors: ['#c9a86a', '#b8b8b8', '#8c7853', '#d4af37', '#a8a9ad', '#704214'] },
  { name: 'Tierra', colors: ['#7c6a4f', '#a67c52', '#c9ada7', '#6b705c', '#b7b7a4', '#ffe8d6'] },
  { name: 'Vintage', colors: ['#eae2b7', '#f4a261', '#e76f51', '#2a9d8f', '#264653', '#e9c46a'] },
  { name: 'Mono', colors: ['#0a0a0a', '#3a3a3a', '#6b6b6b', '#a0a0a0', '#d4d4d4', '#ffffff'] },
];

// Selector de color propio: paletas preestablecidas + selector RGB completo
// (reutiliza el input nativo solo para eso, ya que hacer un selector RGB
// entero a mano añade mucho riesgo sin poder probarlo) + pipeta con la
// EyeDropper API del navegador cuando está disponible.
function ColorPicker({ label, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [activePalette, setActivePalette] = useState(0);
  const supportsEyedropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  async function pickWithEyedropper() {
    try {
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      onChange(result.sRGBHex);
    } catch (err) {
      // el usuario canceló la pipeta, no hay que hacer nada
    }
  }

  return (
    <div className="color-picker">
      <button
        type="button"
        className="color-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="color-swatch-big" style={{ background: value }} />
        <span>{label}</span>
      </button>
      {open && !disabled && (
        <div className="color-panel">
          <div className="palette-tabs">
            {PALETTES.map((p, i) => (
              <button
                type="button"
                key={p.name}
                className={'palette-tab' + (i === activePalette ? ' active' : '')}
                onClick={() => setActivePalette(i)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="palette-swatches">
            {PALETTES[activePalette].colors.map((c) => (
              <button
                type="button"
                key={c}
                className="palette-swatch"
                style={{ background: c }}
                onClick={() => onChange(c)}
              />
            ))}
          </div>
          <div className="color-panel-footer">
            <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
            {supportsEyedropper && (
              <button type="button" className="eyedropper-btn" onClick={pickWithEyedropper}>
                🎨 Pipeta
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Lista amplia de Google Fonts, agrupada por estilo. Se cargan todas de una
// vez en index.html; aquí solo se listan para el selector. El navegador no
// descarga el archivo de una fuente hasta que algo la usa de verdad, así que
// tenerlas todas listadas no penaliza la carga inicial de la página.
const FONTS = [
  { id: 'space', label: 'Space Grotesk', family: "'Space Grotesk', sans-serif", group: 'Limpias' },
  { id: 'josefin', label: 'Josefin Sans', family: "'Josefin Sans', sans-serif", group: 'Limpias' },
  { id: 'quicksand', label: 'Quicksand', family: "'Quicksand', sans-serif", group: 'Limpias' },
  { id: 'inter', label: 'Inter', family: "'Inter', sans-serif", group: 'Limpias' },
  { id: 'poppins', label: 'Poppins', family: "'Poppins', sans-serif", group: 'Limpias' },
  { id: 'nunito', label: 'Nunito', family: "'Nunito', sans-serif", group: 'Limpias' },
  { id: 'worksans', label: 'Work Sans', family: "'Work Sans', sans-serif", group: 'Limpias' },
  { id: 'outfit', label: 'Outfit', family: "'Outfit', sans-serif", group: 'Limpias' },
  { id: 'caveat', label: 'Caveat', family: "'Caveat', cursive", group: 'Manuscritas' },
  { id: 'marker', label: 'Permanent Marker', family: "'Permanent Marker', cursive", group: 'Manuscritas' },
  { id: 'amatic', label: 'Amatic SC', family: "'Amatic SC', cursive", group: 'Manuscritas' },
  { id: 'gochi', label: 'Gochi Hand', family: "'Gochi Hand', cursive", group: 'Manuscritas' },
  { id: 'shadows', label: 'Shadows Into Light', family: "'Shadows Into Light', cursive", group: 'Manuscritas' },
  { id: 'kalam', label: 'Kalam', family: "'Kalam', cursive", group: 'Manuscritas' },
  { id: 'satisfy', label: 'Satisfy', family: "'Satisfy', cursive", group: 'Manuscritas' },
  { id: 'homemade', label: 'Homemade Apple', family: "'Homemade Apple', cursive", group: 'Manuscritas' },
  { id: 'dancing', label: 'Dancing Script', family: "'Dancing Script', cursive", group: 'Script' },
  { id: 'sacramento', label: 'Sacramento', family: "'Sacramento', cursive", group: 'Script' },
  { id: 'pacifico', label: 'Pacifico', family: "'Pacifico', cursive", group: 'Script' },
  { id: 'vibes', label: 'Great Vibes', family: "'Great Vibes', cursive", group: 'Script' },
  { id: 'playfair', label: 'Playfair Display', family: "'Playfair Display', serif", group: 'Moda / editorial' },
  { id: 'bodoni', label: 'Bodoni Moda', family: "'Bodoni Moda', serif", group: 'Moda / editorial' },
  { id: 'abril', label: 'Abril Fatface', family: "'Abril Fatface', serif", group: 'Moda / editorial' },
  { id: 'cormorant', label: 'Cormorant Garamond', family: "'Cormorant Garamond', serif", group: 'Moda / editorial' },
  { id: 'dmserif', label: 'DM Serif Display', family: "'DM Serif Display', serif", group: 'Moda / editorial' },
  { id: 'libre', label: 'Libre Baskerville', family: "'Libre Baskerville', serif", group: 'Moda / editorial' },
  { id: 'lora', label: 'Lora', family: "'Lora', serif", group: 'Moda / editorial' },
  { id: 'prata', label: 'Prata', family: "'Prata', serif", group: 'Moda / editorial' },
  { id: 'marcellus', label: 'Marcellus', family: "'Marcellus', serif", group: 'Moda / editorial' },
  { id: 'bebas', label: 'Bebas Neue', family: "'Bebas Neue', sans-serif", group: 'Display' },
  { id: 'anton', label: 'Anton', family: "'Anton', sans-serif", group: 'Display' },
  { id: 'archivo', label: 'Archivo Black', family: "'Archivo Black', sans-serif", group: 'Display' },
  { id: 'passion', label: 'Passion One', family: "'Passion One', sans-serif", group: 'Display' },
  { id: 'alfa', label: 'Alfa Slab One', family: "'Alfa Slab One', sans-serif", group: 'Display' },
  { id: 'bungee', label: 'Bungee', family: "'Bungee', sans-serif", group: 'Display' },
  { id: 'baloo', label: 'Baloo 2', family: "'Baloo 2', sans-serif", group: 'Redondeadas' },
  { id: 'comfortaa', label: 'Comfortaa', family: "'Comfortaa', sans-serif", group: 'Redondeadas' },
  { id: 'fredoka', label: 'Fredoka', family: "'Fredoka', sans-serif", group: 'Redondeadas' },
  { id: 'varela', label: 'Varela Round', family: "'Varela Round', sans-serif", group: 'Redondeadas' },
];
function fontFamilyFor(id) {
  const f = FONTS.find((x) => x.id === id);
  return f ? f.family : "'Space Grotesk', sans-serif";
}

// Selector de fuente con buscador — con ~35 opciones un <select> plano ya
// cuesta de recorrer, así que se puede filtrar escribiendo.
function FontPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = FONTS.find((f) => f.id === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? FONTS.filter((f) => f.label.toLowerCase().includes(q) || f.group.toLowerCase().includes(q)) : FONTS;
  const groups = [];
  const seen = {};
  filtered.forEach((f) => {
    if (!seen[f.group]) { seen[f.group] = []; groups.push(f.group); }
    seen[f.group].push(f);
  });

  return (
    <div className="font-picker">
      <button type="button" className="font-trigger" onClick={() => setOpen((o) => !o)}>
        <span style={{ fontFamily: current ? current.family : undefined }}>
          {current ? current.label : 'Elegir tipografía'}
        </span>
      </button>
      {open && (
        <div className="font-panel">
          <input
            type="text"
            placeholder="Buscar tipografía…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="font-list">
            {groups.map((g) => (
              <div key={g}>
                <p className="font-group-label">{g}</p>
                {seen[g].map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    className={'font-option' + (f.id === value ? ' active' : '')}
                    style={{ fontFamily: f.family }}
                    onClick={() => { onChange(f.id); setOpen(false); setQuery(''); }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const App = () => {
  const [pages, setPages] = useState(() => Array.from({ length: 12 }, (_, i) => makeDefaultPage(i)));
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null); // 'photo' | 'grid' | null
  const [showCropModal, setShowCropModal] = useState(false);
  const fileInputRef = useRef();
  const bgFileInputRef = useRef();
  const wrapRef = useRef();
  const [scale, setScale] = useState(1);

  const page = pages[current];
  const [img] = useImage(page.photoUrl || '', 'anonymous');

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

  // Calcula el recorte inicial UNA sola vez, la primera vez que una foto
  // termina de cargar y todavía no tiene recorte guardado. A partir de ahí
  // es estado normal: no se vuelve a recentrar sola. De paso abre la
  // ventana de recorte, como al "precortar" al subir la foto.
  useEffect(() => {
    if (img && page.photoUrl && !page.photo.cropW) {
      const def = computeDefaultCrop(img.width, img.height, page.photo.width, page.photo.height);
      updatePagePhoto({ ...page.photo, ...def, baseCropW: def.cropW, baseCropH: def.cropH, zoom: 1 });
      setShowCropModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, page.photoUrl]);

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
    if (field === 'font' && typeof document !== 'undefined' && document.fonts) {
      // Canvas no espera solo a que el fichero de la fuente termine de
      // cargar como sí hace el texto normal — si no se fuerza, la primera
      // vez que eliges una tipografía puede pintarse con la de repuesto
      // hasta el siguiente redibujado. document.fonts.load() lo evita.
      const family = fontFamilyFor(value).split(',')[0].replace(/'/g, '');
      document.fonts.load(`16px "${family}"`).then(() => {
        setPages((prev) => [...prev]); // fuerza un redibujado una vez cargada de verdad
      }).catch(() => {});
    }
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
    reader.onload = () => {
      // Se limpia el recorte guardado: es del archivo anterior, no vale para
      // el nuevo — el efecto de arriba calculará uno nuevo en cuanto cargue.
      updatePagePhoto({ ...page.photo, cropX: undefined, cropY: undefined, cropW: undefined, cropH: undefined, baseCropW: undefined, baseCropH: undefined, zoom: 1 });
      updatePageField('photoUrl', reader.result);
    };
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
          {page.photoUrl && (
            <div className="field">
              <button
                type="button"
                style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 8, background: '#fff', cursor: 'pointer' }}
                onClick={() => setShowCropModal(true)}
              >
                Recortar foto
              </button>
            </div>
          )}
          <div className="field">
            <p className="label">Título del mes</p>
            <input type="text" value={page.title.text} onChange={(e) => updateTitleField('text', e.target.value)} />
          </div>
          <div className="field">
            <p className="label">Tipografía del título</p>
            <FontPicker value={page.title.font} onChange={(v) => updateTitleField('font', v)} />
          </div>
          <div className="field">
            <p className="label">Tamaño del título</p>
            <input type="range" min="16" max="64" value={page.title.fontSize} onChange={(e) => updateTitleField('fontSize', +e.target.value)} />
          </div>
          <div className="field">
            <ColorPicker label="Color del título" value={page.title.color} onChange={(c) => updateTitleField('color', c)} />
          </div>
          <div className="field">
            <ColorPicker label="Color de fondo" value={page.bg} onChange={(c) => updatePageField('bg', c)} disabled={!!page.bgPhotoUrl} />
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
              <option value="boxed">Recuadros</option>
              <option value="dots">Puntos</option>
              <option value="circles">Círculos</option>
              <option value="cards">Tarjetas</option>
            </select>
          </div>
          <div className="field">
            <ColorPicker label="Color de los números" value={page.gridColor} onChange={(c) => updatePageField('gridColor', c)} />
          </div>
          <div className="field">
            <ColorPicker label="Color de las líneas" value={page.gridLineColor} onChange={(c) => updatePageField('gridLineColor', c)} />
          </div>
          {page.gridBox && (
            <div className="field">
              <button
                type="button"
                style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 8, background: '#fff', cursor: 'pointer' }}
                onClick={() => updatePageField('gridBox', null)}
              >
                Posición automática de la cuadrícula
              </button>
            </div>
          )}
          <p className="hint">
            Toca la foto, el título o la cuadrícula para seleccionarlos. Arrastra para mover;
            con la foto o la cuadrícula seleccionada, usa las esquinas para redimensionar.
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
                    img={img}
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
                    width={STAGE_W - page.title.x - GRID_MARGIN}
                    wrap="word"
                    fontSize={page.title.fontSize}
                    fill={page.title.color}
                    fontFamily={fontFamilyFor(page.title.font)}
                    draggable
                    onDragEnd={handleTitleDragEnd}
                  />
                  <CalendarGrid
                    monthIdx={current}
                    page={page}
                    titleFontFamily={fontFamilyFor(page.title.font)}
                    selected={selected === 'grid'}
                    onSelect={() => setSelected('grid')}
                    onChange={(box) => updatePageField('gridBox', box)}
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
            onClick={() => { setCurrent(i); setSelected(null); setShowCropModal(false); }}
          >
            {m.slice(0, 3)}
          </button>
        ))}
      </div>

      {showCropModal && img && (
        <CropModal
          page={page}
          img={img}
          onCancel={() => setShowCropModal(false)}
          onConfirm={(nextPhoto) => { updatePagePhoto(nextPhoto); setShowCropModal(false); }}
        />
      )}
    </div>
  );
};

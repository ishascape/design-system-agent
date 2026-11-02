/* global figma, PAYLOAD */
/**
 * Runs inside Figma via the official Figma MCP `use_figma` tool (Plugin API).
 * `PAYLOAD` is injected by @dsa/gen-figma: tokens, the Button spec and known Figma ids.
 * Without `PAYLOAD.button` only the variables are synced.
 *
 * Idempotent: variables and the component set are found by stored id, then by name, and updated
 * in place. Nothing is deleted except variants this script itself owns and no longer needs.
 * Returns ids and a structural read-back for verification.
 */
const hexToRgb = (h) => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});
// Variables can hold alpha (#rrggbbaa); paints cannot, so this is only used for variable values.
const hexToRgba = (h) => ({ ...hexToRgb(h), a: h.length === 9 ? parseInt(h.slice(7, 9), 16) / 255 : 1 });

// ---------- Variables ----------
const collections = await figma.variables.getLocalVariableCollectionsAsync();
let collection =
  (PAYLOAD.ids.collection && collections.find((c) => c.id === PAYLOAD.ids.collection)) ||
  collections.find((c) => c.name === PAYLOAD.collectionName);
if (!collection) collection = figma.variables.createVariableCollection(PAYLOAD.collectionName);
collection.name = PAYLOAD.collectionName;
const modeId = collection.modes[0].modeId;
if (collection.modes[0].name !== 'Value') collection.renameMode(modeId, 'Value');

const existing = await figma.variables.getLocalVariablesAsync();
const vars = {};
const variableIds = {};
for (const t of PAYLOAD.variables) {
  const knownId = PAYLOAD.ids.variables[t.name];
  let v =
    (knownId && existing.find((x) => x.id === knownId)) ||
    existing.find((x) => x.name === t.figmaName && x.variableCollectionId === collection.id);
  if (v && v.resolvedType !== t.figmaType) {
    throw new Error(
      `Variable ${t.figmaName} exists with type ${v.resolvedType}, expected ${t.figmaType}. Fix by hand; not deleting.`,
    );
  }
  if (!v) v = figma.variables.createVariable(t.figmaName, collection, t.figmaType);
  v.name = t.figmaName;
  v.description = t.description;
  v.scopes = t.scopes;
  v.setVariableCodeSyntax('WEB', `var(${t.cssVar})`);
  v.setValueForMode(modeId, t.figmaType === 'COLOR' ? hexToRgba(t.value) : t.value);
  vars[t.name] = v;
  variableIds[t.name] = v.id;
}

if (!PAYLOAD.button) return { collectionId: collection.id, variableIds };

// ---------- Button component set ----------
const spec = PAYLOAD.button;
const V = (name) => {
  const v = vars[name];
  if (!v) throw new Error(`Button needs token ${name}, which was not synced`);
  return v;
};
const tokenByName = Object.fromEntries(PAYLOAD.variables.map((t) => [t.name, t]));
// The raw colour is the fallback Figma shows wherever a binding is not resolved (some renders,
// exports, detached copies), so it must equal the token value, not black.
const paint = (name, opacity = 1) =>
  figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: hexToRgb(tokenByName[name].value), opacity },
    'color',
    V(name),
  );

const fontFamily = PAYLOAD.font.family;
const fontStyle = PAYLOAD.font.style;
await figma.loadFontAsync({ family: fontFamily, style: fontStyle });

let set = PAYLOAD.ids.componentSet ? await figma.getNodeByIdAsync(PAYLOAD.ids.componentSet) : null;
if (set && set.type !== 'COMPONENT_SET') set = null;
if (!set) set = figma.currentPage.findOne((n) => n.type === 'COMPONENT_SET' && n.name === spec.name);

function styleVariant(c, variant, state) {
  const filled = variant.toLowerCase() === 'primary';
  const hover = state === 'Hover';
  c.layoutMode = 'HORIZONTAL';
  c.primaryAxisSizingMode = 'AUTO';
  c.counterAxisSizingMode = 'AUTO';
  c.primaryAxisAlignItems = 'CENTER';
  c.counterAxisAlignItems = 'CENTER';
  c.clipsContent = false;
  c.setBoundVariable('paddingLeft', V('space.4'));
  c.setBoundVariable('paddingRight', V('space.4'));
  c.setBoundVariable('itemSpacing', V('space.2'));
  c.setBoundVariable('minHeight', V('size.tap'));
  for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'])
    c.setBoundVariable(k, V('radius.default'));
  c.fills = hover ? [paint('color.marker')] : filled ? [paint('color.ink')] : [];
  c.strokes = [paint(hover ? 'color.marker' : 'color.ink')];
  c.strokeAlign = 'INSIDE';
  // strokeWeight cannot hold a binding on its own (found in Gate 0); bind each side.
  for (const k of ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'])
    c.setBoundVariable(k, V('line.building'));
  c.opacity = state === 'Disabled' ? PAYLOAD.constants.disabledOpacity : 1;

  // Label
  let label = c.findOne((n) => n.type === 'TEXT' && n.name === 'Label');
  if (!label) {
    label = figma.createText();
    label.name = 'Label';
    c.appendChild(label);
  }
  label.fontName = { family: fontFamily, style: fontStyle };
  label.setBoundVariable('fontSize', V('font.size.body'));
  label.lineHeight = { unit: 'PERCENT', value: PAYLOAD.constants.lineHeightPercent };
  if (!label.characters) label.characters = spec.defaultLabel;
  label.fills = [paint(hover || filled ? 'color.paper' : 'color.ink')];
  label.textAutoResize = 'WIDTH_AND_HEIGHT';

  // Corner marks (hover and focus) and focus ring (focus only), positioned outside the box.
  const showMarks = state === 'Hover' || state === 'Focus';
  const mark = (name, corner) => {
    let m = c.findOne((n) => n.name === name);
    if (!m) {
      m = figma.createFrame();
      m.name = name;
      c.appendChild(m);
    }
    m.layoutPositioning = 'ABSOLUTE';
    m.resize(PAYLOAD.constants.cornerMarkSize, PAYLOAD.constants.cornerMarkSize);
    m.fills = [];
    m.strokes = [paint('color.graphite', PAYLOAD.constants.cornerMarkOpacity)];
    m.strokeAlign = 'INSIDE';
    const w = V('line.building');
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const on = corner === 'top-left' ? side === 'Top' || side === 'Left' : side === 'Bottom' || side === 'Right';
      if (on) m.setBoundVariable(`stroke${side}Weight`, w);
      else {
        m.setBoundVariable(`stroke${side}Weight`, null);
        m[`stroke${side}Weight`] = 0;
      }
    }
    m.visible = showMarks;
    return m;
  };
  const off = PAYLOAD.constants.cornerMarkOffset;
  const tl = mark('Corner mark / top-left', 'top-left');
  const br = mark('Corner mark / bottom-right', 'bottom-right');
  tl.x = -off;
  tl.y = -off;
  br.x = c.width - PAYLOAD.constants.cornerMarkSize + off;
  br.y = c.height - PAYLOAD.constants.cornerMarkSize + off;

  let ring = c.findOne((n) => n.name === 'Focus ring');
  if (!ring) {
    ring = figma.createFrame();
    ring.name = 'Focus ring';
    c.appendChild(ring);
  }
  const gap = PAYLOAD.constants.focusRingOffset + PAYLOAD.constants.focusRingWidth;
  ring.layoutPositioning = 'ABSOLUTE';
  ring.resize(c.width + gap * 2, c.height + gap * 2);
  ring.x = -gap;
  ring.y = -gap;
  ring.fills = [];
  ring.strokes = [paint('color.marker')];
  ring.strokeWeight = PAYLOAD.constants.focusRingWidth;
  ring.strokeAlign = 'INSIDE';
  ring.cornerRadius = PAYLOAD.constants.radius + gap;
  ring.visible = state === 'Focus';
  return label;
}

const wanted = [];
for (const variant of spec.variants)
  for (const state of spec.states) wanted.push({ variant, state, name: `Variant=${variant}, State=${state}` });

const created = [];
if (!set) {
  const comps = wanted.map((w) => {
    const c = figma.createComponent();
    c.name = w.name;
    styleVariant(c, w.variant, w.state);
    return c;
  });
  set = figma.combineAsVariants(comps, figma.currentPage);
  set.name = spec.name;
  created.push(...comps.map((c) => c.id));
} else {
  for (const w of wanted) {
    let c = set.children.find((n) => n.name === w.name);
    if (!c) {
      c = figma.createComponent();
      c.name = w.name;
      set.appendChild(c);
      created.push(c.id);
    }
    styleVariant(c, w.variant, w.state);
  }
}
// Variants named by this script that the spec no longer has are removed; anything else is left alone.
const removed = [];
for (const c of [...set.children]) {
  const owned = /^Variant=[A-Za-z]+, State=[A-Za-z]+$/.test(c.name);
  if (owned && !wanted.some((w) => w.name === c.name)) {
    removed.push(c.name);
    c.remove();
  }
}

// Order and lay out variants: one row per variant, one column per state.
set.layoutMode = 'NONE';
const colW = 260;
const rowH = 100;
wanted.forEach((w, i) => {
  const c = set.children.find((n) => n.name === w.name);
  set.appendChild(c);
  c.x = 32 + (i % spec.states.length) * colW;
  c.y = 32 + Math.floor(i / spec.states.length) * rowH;
});
set.resizeWithoutConstraints(
  32 * 2 + spec.states.length * colW - (colW - 200),
  32 * 2 + spec.variants.length * rowH - (rowH - 44),
);

// Label text property, shared by every variant.
const defs = set.componentPropertyDefinitions;
let labelKey = Object.keys(defs).find((k) => k.startsWith('Label#'));
if (!labelKey) labelKey = set.addComponentProperty('Label', 'TEXT', spec.defaultLabel);
for (const c of set.children) {
  const t = c.findOne((n) => n.type === 'TEXT' && n.name === 'Label');
  if (t) t.componentPropertyReferences = { characters: labelKey };
}
set.description = spec.description;

// ---------- Read-back ----------
const localVars = await figma.variables.getLocalVariablesAsync();
const allVars = Object.fromEntries(localVars.map((v) => [v.id, v.name]));
const varValue = Object.fromEntries(localVars.map((v) => [v.id, v.valuesByMode[modeId]]));
const close = (a, b) => Math.abs(a - b) < 0.002;
// Bound paints whose raw (fallback) colour differs from the bound variable's value.
const stalePaints = (node) => {
  const out = [];
  for (const n of [node, ...node.findAll(() => true)]) {
    for (const key of ['fills', 'strokes']) {
      const paints = n[key];
      if (!Array.isArray(paints)) continue;
      for (const p of paints) {
        const a = p.boundVariables && p.boundVariables.color;
        const val = a && varValue[a.id];
        if (val && !(close(val.r, p.color.r) && close(val.g, p.color.g) && close(val.b, p.color.b)))
          out.push(`${n.name}.${key}`);
      }
    }
  }
  return out;
};
const nm = (a) => (a ? allVars[a.id] || `unknown:${a.id}` : null);
const finalDefs = set.componentPropertyDefinitions;
const readback = {
  componentSet: { id: set.id, type: set.type, name: set.name },
  properties: Object.fromEntries(
    Object.entries(finalDefs).map(([k, d]) => [k.split('#')[0], { type: d.type, options: d.variantOptions || null }]),
  ),
  variants: set.children.map((c) => {
    const b = c.boundVariables || {};
    const label = c.findOne((n) => n.type === 'TEXT' && n.name === 'Label');
    const lb = (label && label.boundVariables) || {};
    return {
      id: c.id,
      name: c.name,
      layoutMode: c.layoutMode,
      opacity: c.opacity,
      fill: c.fills.length ? nm(c.fills[0].boundVariables && c.fills[0].boundVariables.color) : 'none',
      stroke: nm(c.strokes[0] && c.strokes[0].boundVariables && c.strokes[0].boundVariables.color),
      strokeWeight: nm(b.strokeTopWeight),
      radius: nm(b.topLeftRadius),
      paddingX: nm(b.paddingLeft),
      gap: nm(b.itemSpacing),
      minHeight: nm(b.minHeight),
      label: label
        ? {
            fill: nm(label.fills[0] && label.fills[0].boundVariables && label.fills[0].boundVariables.color),
            fontSize: nm(lb.fontSize && (Array.isArray(lb.fontSize) ? lb.fontSize[0] : lb.fontSize)),
            font: `${label.fontName.family} ${label.fontName.style}`,
            boundToProperty: !!(label.componentPropertyReferences && label.componentPropertyReferences.characters),
          }
        : null,
      cornerMarksVisible: c.children.filter((n) => n.name.startsWith('Corner mark')).every((n) => n.visible),
      focusRingVisible: !!c.children.find((n) => n.name === 'Focus ring' && n.visible),
      stalePaints: stalePaints(c),
      width: Math.round(c.width),
      height: Math.round(c.height),
    };
  }),
};

return {
  collectionId: collection.id,
  variableIds,
  componentSetId: set.id,
  createdNodeIds: created,
  removedVariants: removed,
  labelProperty: labelKey,
  readback,
};

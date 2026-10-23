const sharp = require("sharp");
// Couleur fixe par type d'opération, commune avec la carte du front
const { couleurOperation } = require("./couleursOperations.js");

// Jaune vif : le gris utilisé initialement se fondait dans les tons gris/beige
// des parcelles agricoles sur les vues satellite réelles, le rendant invisible.
const SITE_CONTOUR_COLOR = "ffe600";

// Valeur par défaut si l'appelant ne précise pas options.aspectRatio
const MAP_ASPECT_RATIO = 900 / 580;
const MAP_FETCH_WIDTH_PX = 1600;
const MAX_LEGEND_ITEMS = 12;
const MERCATOR_R = 6378137;
const WMS_FETCH_TIMEOUT_MS = 15000;

const GEOM_DEPTH = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3,
};

function lonLatToMercator(lon, lat) {
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const x = MERCATOR_R * (lon * Math.PI / 180);
    const y = MERCATOR_R * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI / 180) / 2));
    return [x, y];
}

// Parcourt récursivement des coordonnées GeoJSON (quelle que soit leur profondeur d'imbrication)
function mapCoordinates(coords, depth, fn) {
    if (depth === 0) return fn(coords);
    return coords.map((c) => mapCoordinates(c, depth - 1, fn));
}

function forEachPoint(geometry, cb) {
    const depth = GEOM_DEPTH[geometry.type];
    if (depth === undefined) return;
    mapCoordinates(geometry.coordinates, depth, (pt) => { cb(pt); return pt; });
}

function projectGeometry(geometry) {
    const depth = GEOM_DEPTH[geometry.type];
    if (depth === undefined) return null;
    return {
        type: geometry.type,
        coordinates: mapCoordinates(geometry.coordinates, depth, ([lon, lat]) => lonLatToMercator(lon, lat)),
    };
}

// Calcule la bbox (en mercator) à partir des seules opérations : plancher de taille minimale,
// marge autour des géométries, puis expansion (jamais crop) pour matcher le ratio cible.
function computeMercatorBBox(featuresMerc, { targetAspectRatio, paddingRatio = 0.15, minSpanMeters = 300 } = {}) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of featuresMerc) {
        forEachPoint(f.geometry, ([x, y]) => {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        });
    }
    if (!Number.isFinite(minX)) throw new Error("Aucune coordonnée valide à cartographier");

    let w = maxX - minX, h = maxY - minY;
    if (w < minSpanMeters) {
        const cx = (minX + maxX) / 2;
        minX = cx - minSpanMeters / 2;
        maxX = cx + minSpanMeters / 2;
        w = minSpanMeters;
    }
    if (h < minSpanMeters) {
        const cy = (minY + maxY) / 2;
        minY = cy - minSpanMeters / 2;
        maxY = cy + minSpanMeters / 2;
        h = minSpanMeters;
    }

    const padX = w * paddingRatio, padY = h * paddingRatio;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    w = maxX - minX; h = maxY - minY;

    const currentRatio = w / h;
    if (targetAspectRatio && currentRatio < targetAspectRatio) {
        const newW = h * targetAspectRatio, cx = (minX + maxX) / 2;
        minX = cx - newW / 2; maxX = cx + newW / 2;
    } else if (targetAspectRatio && currentRatio > targetAspectRatio) {
        const newH = w / targetAspectRatio, cy = (minY + maxY) / 2;
        minY = cy - newH / 2; maxY = cy + newH / 2;
    }
    return { minX, minY, maxX, maxY };
}

// Fournisseurs de fond de plan, essayés dans l'ordre (IGN ORTHO -> ESRI satellite -> OSM en dernier recours)
const BASEMAP_PROVIDERS = [
    {
        name: "IGN ORTHO",
        buildUrl: (bbox, w, h) => `https://data.geopf.fr/wms-r/wms?` + new URLSearchParams({
            SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap",
            LAYERS: "ORTHOIMAGERY.ORTHOPHOTOS", STYLES: "", CRS: "EPSG:3857",
            BBOX: `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`,
            WIDTH: String(w), HEIGHT: String(h), FORMAT: "image/jpeg",
        }),
    },
    {
        name: "ESRI World Imagery",
        buildUrl: (bbox, w, h) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?` +
            new URLSearchParams({
                bbox: `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`,
                bboxSR: "3857", imageSR: "3857", size: `${w},${h}`, format: "jpg", f: "image",
            }),
    },
    {
        name: "OSM (terrestris WMS)",
        buildUrl: (bbox, w, h) => `https://ows.terrestris.de/osm/service?` + new URLSearchParams({
            SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: "OSM-WMS",
            STYLES: "", SRS: "EPSG:3857",
            BBOX: `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`,
            WIDTH: String(w), HEIGHT: String(h), FORMAT: "image/png",
        }),
    },
];

async function fetchBasemapImage(bbox, w, h) {
    for (const provider of BASEMAP_PROVIDERS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), WMS_FETCH_TIMEOUT_MS);
        try {
            const resp = await fetch(provider.buildUrl(bbox, w, h), { signal: controller.signal });
            const contentType = resp.headers.get("content-type") || "";
            if (!resp.ok || !contentType.startsWith("image/")) {
                const body = await resp.text().catch(() => "");
                throw new Error(`réponse invalide (status=${resp.status}, content-type=${contentType}) ${body.slice(0, 200)}`);
            }
            console.log(`[mapGenerator] Fond de plan : ${provider.name} OK`);
            return { buffer: Buffer.from(await resp.arrayBuffer()), providerName: provider.name };
        } catch (err) {
            console.warn(`[mapGenerator] Fond de plan ${provider.name} indisponible : ${err.message}`);
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error("Aucun fournisseur de fond de plan disponible (IGN, ESRI, OSM)");
}

function toPixel([x, y], bbox, w, h) {
    const px = (x - bbox.minX) / (bbox.maxX - bbox.minX) * w;
    const py = h - (y - bbox.minY) / (bbox.maxY - bbox.minY) * h; // inversion : l'axe Y du SVG grandit vers le bas
    return [px, py];
}

function ringToPathData(ring, bbox, w, h) {
    return ring.map(([x, y], i) => {
        const [px, py] = toPixel([x, y], bbox, w, h);
        return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    }).join(" ") + " Z";
}

function lineToPathData(line, bbox, w, h) {
    return line.map(([x, y], i) => {
        const [px, py] = toPixel([x, y], bbox, w, h);
        return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    }).join(" ");
}

function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

// Le contour du site (dashed=true) reçoit un halo sombre continu sous le trait coloré :
// sans ça, une couleur unie peut se fondre dans des parcelles de teinte proche
// (champs gris/beige, colza jaune...) quel que soit le fond satellite réel.
function geometryToSvg(geometry, color, bbox, w, h, { dashed = false, fillOpacity = 0.35 } = {}) {
    switch (geometry.type) {
        case "Polygon": {
            const d = geometry.coordinates.map((r) => ringToPathData(r, bbox, w, h)).join(" ");
            if (dashed) {
                return `<path d="${d}" fill="none" stroke="#000000" stroke-opacity="0.55" stroke-width="5.5"/>` +
                    `<path d="${d}" fill="none" stroke="#${color}" stroke-width="3" stroke-dasharray="14,8"/>`;
            }
            return `<path d="${d}" fill="#${color}" fill-opacity="${fillOpacity}" stroke="#${color}" stroke-width="2.5"/>`;
        }
        case "MultiPolygon":
            return geometry.coordinates.map((poly) => geometryToSvg({ type: "Polygon", coordinates: poly }, color, bbox, w, h, { dashed, fillOpacity })).join("");
        case "LineString": {
            const d = lineToPathData(geometry.coordinates, bbox, w, h);
            if (dashed) {
                return `<path d="${d}" fill="none" stroke="#000000" stroke-opacity="0.55" stroke-width="5.5" stroke-linecap="round"/>` +
                    `<path d="${d}" fill="none" stroke="#${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="14,8"/>`;
            }
            return `<path d="${d}" fill="none" stroke="#${color}" stroke-width="3.5" stroke-linecap="round"/>`;
        }
        case "MultiLineString":
            return geometry.coordinates.map((line) => geometryToSvg({ type: "LineString", coordinates: line }, color, bbox, w, h, { dashed, fillOpacity })).join("");
        case "Point": {
            const [px, py] = toPixel(geometry.coordinates, bbox, w, h);
            return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7" fill="#${color}" fill-opacity="0.9" stroke="#ffffff" stroke-width="2"/>`;
        }
        case "MultiPoint":
            return geometry.coordinates.map((c) => geometryToSvg({ type: "Point", coordinates: c }, color, bbox, w, h, { dashed, fillOpacity })).join("");
        default:
            return "";
    }
}

// code/titre sont souvent vides en pratique sur les opérations ; date_debut est plus
// fiable pour distinguer visuellement des opérations qui partagent le même "type".
// properties.type vaut "libellé(action) / libellé(action_2)" ; comme dans le reste du
// document (rubrique "Type d'opération"), seul le libellé d'action_2 est affiché.
function legendLabelFor(properties) {
    // Pas de date : le numéro suffit à relier l'opération au tableau de la fiche
    const primary = properties.code || properties.titre || "";
    const label = properties.action_2_libelle || properties.type || "";
    if (primary && label) return `${primary} – ${label}`;
    return primary || label || "Opération";
}

function computeVisualCentroid(geometry) {
    let sumX = 0, sumY = 0, count = 0;
    forEachPoint(geometry, ([x, y]) => { sumX += x; sumY += y; count += 1; });
    return count > 0 ? [sumX / count, sumY / count] : null;
}

// Badge rond pour un numéro, pastille allongée pour une géométrie partagée par
// plusieurs opérations (ex. "2, 4, 7" : même parcelle pâturée plusieurs fois).
function buildBadgeSvg(numbers, centroidMerc, color, bbox, w, h) {
    if (!centroidMerc || numbers.length === 0) return "";
    const [px, py] = toPixel(centroidMerc, bbox, w, h);
    const text = numbers.join(", ");
    const r = 15;
    const halfW = Math.max(r, estimateTextWidth(text, 15, { bold: true }) / 2 + 9);
    return `<rect x="${(px - halfW).toFixed(1)}" y="${(py - r).toFixed(1)}" width="${(2 * halfW).toFixed(1)}" height="${2 * r}" rx="${r}" fill="#${color}" stroke="#ffffff" stroke-width="2.5"/>` +
        `<text x="${px.toFixed(1)}" y="${(py + 5).toFixed(1)}" font-size="15" font-weight="bold" font-family="Calibri, sans-serif" fill="#ffffff" text-anchor="middle">${text}</text>`;
}

// Largeur de caractère moyenne approximative pour Calibri sans-serif, proportionnelle
// à la taille de police (le gras élargit un peu le texte, l'italique très peu).
function estimateTextWidth(text, fontSizePx, { bold = false } = {}) {
    return text.length * fontSizePx * (bold ? 0.62 : 0.55);
}

// Dimensions et contenu de la légende, calculés avant le rendu pour pouvoir lui
// réserver de la place dans l'emprise (cf. reserveLegendSpace).
// Largeur de la boîte calculée à partir du texte réel (titre, sous-titre et lignes,
// bornée à la largeur du canevas) pour ne jamais déborder de l'image.
// entries : une entrée par opération { num, color, label }, triée par numéro ;
// seules les `MAX_LEGEND_ITEMS` premières sont affichées.
function layoutLegend(entries, hasSiteContour, w, h) {
    const items = entries.slice(0, MAX_LEGEND_ITEMS);
    const maxLabelChars = 30;
    const labelStartX = 42;
    const contourSampleW = 24; // échantillon du contour du site, assez long pour montrer l'alternance des tirets
    const padLeft = 10;
    const lineH = 23;
    const titleText = "Légende :";
    const subtitleText = "Localisation des opérations par N° :";
    const siteContourText = "Contour du site";

    const labels = items.map((e) => {
        const raw = `${e.num}. ${e.label}`;
        return raw.length > maxLabelChars ? raw.slice(0, maxLabelChars - 1) + "…" : raw;
    });
    const extra = entries.length > MAX_LEGEND_ITEMS ? 1 : 0;

    const contentWidths = [
        padLeft + estimateTextWidth(titleText, 16, { bold: true }),
        padLeft + estimateTextWidth(subtitleText, 12.5),
        ...(hasSiteContour ? [labelStartX + estimateTextWidth(siteContourText, 13.5)] : []),
        ...labels.map((l) => labelStartX + estimateTextWidth(l, 13.5)),
    ];
    const boxW = Math.min(w - 24, Math.max(...contentWidths) + 18);

    const rowCount = 2 + (hasSiteContour ? 1 : 0) + items.length + extra; // titre + sous-titre + contour + lignes
    const boxH = 18 + rowCount * lineH;
    const x0 = Math.max(12, w - boxW - 12), y0 = h - boxH - 12;
    return { items, labels, extra, total: entries.length, hasSiteContour, x0, y0, boxW, boxH, padLeft, labelStartX, contourSampleW, lineH, titleText, subtitleText, siteContourText };
}

function buildLegendSvg(layout) {
    const { items, labels, extra, total, hasSiteContour, x0, y0, boxW, boxH, padLeft, labelStartX, contourSampleW, lineH, titleText, subtitleText, siteContourText } = layout;
    let y = y0 + 24;
    let rows = `<text x="${x0 + padLeft}" y="${y}" font-size="16" font-weight="bold" font-family="Calibri, sans-serif" fill="#1a1a1a">${titleText}</text>`;
    if (hasSiteContour) {
        y += lineH;
        // Même rendu que le contour sur la carte (geometryToSvg) : halo noir continu sous le pointillé jaune
        rows += `<line x1="${x0 + padLeft}" y1="${y - 5}" x2="${x0 + padLeft + contourSampleW}" y2="${y - 5}" stroke="#000000" stroke-opacity="0.55" stroke-width="5.5"/>` +
            `<line x1="${x0 + padLeft}" y1="${y - 5}" x2="${x0 + padLeft + contourSampleW}" y2="${y - 5}" stroke="#${SITE_CONTOUR_COLOR}" stroke-width="3" stroke-dasharray="7,4"/>` +
            `<text x="${x0 + labelStartX}" y="${y}" font-size="13.5" font-family="Calibri, sans-serif" fill="#222222">${siteContourText}</text>`;
    }
    y += lineH;
    rows += `<text x="${x0 + padLeft}" y="${y}" font-size="12.5" font-style="italic" font-family="Calibri, sans-serif" fill="#333333">${subtitleText}</text>`;

    items.forEach((e, i) => {
        y += lineH;
        const color = e.color;
        rows += `<rect x="${x0 + padLeft}" y="${y - 12}" width="14" height="14" fill="#${color}"/><text x="${x0 + labelStartX}" y="${y}" font-size="13.5" font-family="Calibri, sans-serif" fill="#222222">${escapeXml(labels[i])}</text>`;
    });
    if (extra) {
        y += lineH;
        rows += `<text x="${x0 + padLeft}" y="${y}" font-size="12" font-style="italic" fill="#666666">+${total - MAX_LEGEND_ITEMS} autres opérations</text>`;
    }

    return `<rect x="${x0}" y="${y0}" width="${boxW}" height="${boxH}" rx="6" fill="#ffffff" fill-opacity="0.92" stroke="#999999"/>${rows}`;
}

// Flèche du nord (coin inférieur gauche) — l'image n'étant pas tournée, l'axe vertical
// de la projection EPSG:3857 correspond au nord pour l'emprise réduite d'un rapport.
function buildNorthArrowSvg(w, h) {
    const cx = 46, cy = h - 115, r = 28;
    // Flèche dans la moitié haute du cercle, lettre "N" dans la moitié basse : les deux
    // restent nettement à l'intérieur du cercle, sans toucher son bord.
    return `<g>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" fill-opacity="0.8" stroke="#666666" stroke-width="1.5"/>
        <polygon points="${cx},${cy - 20} ${cx - 9},${cy + 2} ${cx},${cy - 6} ${cx + 9},${cy + 2}" fill="#1a1a1a"/>
        <text x="${cx}" y="${cy + 19}" font-size="13" font-weight="bold" font-family="Calibri, sans-serif" fill="#1a1a1a" text-anchor="middle">N</text>
    </g>`;
}

// Choisit une valeur ronde (1/2/5 x 10^n) inférieure ou égale à la valeur cible, pour
// afficher une distance lisible sur la barre d'échelle plutôt qu'un nombre arbitraire.
function chooseNiceScaleMeters(targetMeters) {
    if (!Number.isFinite(targetMeters) || targetMeters <= 0) return 10;
    const magnitude = Math.pow(10, Math.floor(Math.log10(targetMeters)));
    const residual = targetMeters / magnitude;
    if (residual >= 5) return 5 * magnitude;
    if (residual >= 2) return 2 * magnitude;
    return magnitude;
}

// Barre d'échelle graphique (coin inférieur gauche, à côté de la flèche du nord).
// La projection Web Mercator dilate les distances avec la latitude : on corrige par
// cos(latitude) pour afficher une échelle représentative du terrain, pas de l'écran.
function buildScaleBarSvg(bbox, w, h) {
    const metersPerPxMercator = (bbox.maxX - bbox.minX) / w;
    const centerY = (bbox.minY + bbox.maxY) / 2;
    const latRad = 2 * Math.atan(Math.exp(centerY / MERCATOR_R)) - Math.PI / 2;
    const metersPerPxGround = metersPerPxMercator * Math.cos(latRad);

    const targetBarPx = w * 0.14;
    const niceMeters = chooseNiceScaleMeters(targetBarPx * metersPerPxGround);
    const barPx = niceMeters / metersPerPxGround;
    const label = niceMeters >= 1000 ? `${niceMeters / 1000} km` : `${niceMeters} m`;

    const x0 = 90, y0 = h - 60, tick = 6;
    return `<g>
        <rect x="${x0 - 6}" y="${y0 - 22}" width="${barPx + 12}" height="20" fill="#ffffff" fill-opacity="0.8" rx="3"/>
        <text x="${x0 + barPx / 2}" y="${y0 - 8}" font-size="12.5" font-family="Calibri, sans-serif" fill="#1a1a1a" text-anchor="middle">${label}</text>
        <line x1="${x0}" y1="${y0}" x2="${x0 + barPx}" y2="${y0}" stroke="#1a1a1a" stroke-width="2.5"/>
        <line x1="${x0}" y1="${y0 - tick}" x2="${x0}" y2="${y0 + tick}" stroke="#1a1a1a" stroke-width="2.5"/>
        <line x1="${x0 + barPx}" y1="${y0 - tick}" x2="${x0 + barPx}" y2="${y0 + tick}" stroke="#1a1a1a" stroke-width="2.5"/>
    </g>`;
}

// Crédits des sources, en bas à gauche sous la flèche du nord / barre d'échelle.
function buildCreditSvg(basemapProviderName, w, h) {
    const lines = [`Fond de plan : ${basemapProviderName}`];

    const fontSize = 10.5, lineH = 13, padX = 6;
    const widestLinePx = Math.max(...lines.map((l) => estimateTextWidth(l, fontSize)));
    const boxW = Math.min(w - 20, widestLinePx + padX * 2 + 4);
    const boxH = lines.length * lineH + 6;
    const x0 = 10, y0 = h - boxH - 8;

    const textRows = lines.map((line, i) =>
        `<text x="${x0 + padX}" y="${y0 + 14 + i * lineH}" font-size="${fontSize}" font-family="Calibri, sans-serif" fill="#333333">${escapeXml(line)}</text>`
    ).join("");

    return `<rect x="${x0}" y="${y0}" width="${boxW}" height="${boxH}" rx="4" fill="#ffffff" fill-opacity="0.75"/>${textRows}`;
}

// Emprise acceptée pour une géométrie d'opération (France métropolitaine, large) :
// une géométrie saisie dans le mauvais système de coordonnées tombe loin d'ici
// (ex. au large du golfe de Guinée) et donnerait une carte blanche.
const LON_MIN = -6.5, LON_MAX = 10, LAT_MIN = 41, LAT_MAX = 51.5;

function isInMetropolitanFrance(geometry) {
    let ok = true;
    forEachPoint(geometry, ([lon, lat]) => {
        if (!(lon >= LON_MIN && lon <= LON_MAX && lat >= LAT_MIN && lat <= LAT_MAX)) ok = false;
    });
    return ok;
}

// Parties simples d'une géométrie (un Multi* donne une partie par élément).
function geometryParts(geometry) {
    const single = { MultiPolygon: "Polygon", MultiLineString: "LineString", MultiPoint: "Point" }[geometry.type];
    return single ? geometry.coordinates.map((c) => ({ type: single, coordinates: c })) : [geometry];
}

// Points d'ancrage des badges, un par partie : un multipolygone (fauche ici et là-bas)
// reçoit le même badge sur chacune de ses parties au lieu d'un seul au centroïde
// global, souvent dans le vide entre elles. points_etiquette (ST_PointOnSurface de
// chaque partie, calculé en SQL) tombe toujours dans la partie ; à défaut, moyenne
// des sommets de chaque partie.
function labelPointsMerc(feature) {
    const pts = feature.properties?.points_etiquette;
    if (pts && GEOM_DEPTH[pts.type] !== undefined) {
        return geometryParts(pts).map((p) => lonLatToMercator(...p.coordinates));
    }
    return geometryParts(feature.geometry).map((p) => computeVisualCentroid(projectGeometry(p))).filter(Boolean);
}

function extentOf(geometry) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    forEachPoint(geometry, ([x, y]) => {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    return { minX, minY, maxX, maxY };
}

// Une forme par géométrie distincte : des opérations successives sur la même parcelle
// (pâturage tournant, fauches répétées) partagent un seul dessin et un badge "2, 4, 7",
// au lieu de badges empilés dont seul le dernier reste visible.
function groupByGeometry(features, numberOf) {
    const groups = new Map();
    for (const f of features) {
        const key = `${f.geometry.type}|${JSON.stringify(f.geometry.coordinates)}`;
        let g = groups.get(key);
        if (!g) {
            const geometry = projectGeometry(f.geometry);
            g = { geometry, extent: extentOf(geometry), labelPoints: labelPointsMerc(f), numbers: [], actions2: [] };
            groups.set(key, g);
        }
        const num = numberOf(f);
        if (!g.numbers.includes(num)) {
            g.numbers.push(num);
            g.actions2.push(f.properties.action_2);
        }
    }
    return [...groups.values()].map((g) => {
        const order = g.numbers.map((n, i) => [n, g.actions2[i]]).sort((a, b) => a[0] - b[0]);
        return { ...g, numbers: order.map(([n]) => n), color: couleurOperation(order[0][1]) };
    });
}

// Si une géométrie passe sous la légende, recadre pour que les opérations tiennent
// soit à gauche de la légende, soit au-dessus, en gardant le cadrage le plus serré.
function reserveLegendSpace(bbox, groups, legend, w, h) {
    const margin = 12;
    const lx0 = legend.x0 - margin, ly0 = legend.y0 - margin;
    const hidden = groups.some(({ extent }) => {
        const [x1, y1] = toPixel([extent.minX, extent.maxY], bbox, w, h);
        const [x2, y2] = toPixel([extent.maxX, extent.minY], bbox, w, h);
        return x2 > lx0 && y2 > ly0 && x1 < w && y1 < h;
    });
    if (!hidden) return bbox;

    const geoms = groups.map((g) => ({ geometry: g.geometry }));
    const candidates = [];
    if (lx0 > w * 0.4) {
        // Opérations dans la bande gauche, la légende occupe le reste à droite
        const b = computeMercatorBBox(geoms, { targetAspectRatio: lx0 / h });
        candidates.push({ ...b, maxX: b.minX + (b.maxX - b.minX) * w / lx0 });
    }
    if (ly0 > h * 0.4) {
        // Opérations dans la bande haute, la légende occupe le bas
        const b = computeMercatorBBox(geoms, { targetAspectRatio: w / ly0 });
        candidates.push({ ...b, minY: b.maxY - (b.maxY - b.minY) * h / ly0 });
    }
    if (candidates.length === 0) return bbox;
    return candidates.reduce((best, c) => (c.maxX - c.minX < best.maxX - best.minX ? c : best));
}

// Badges de chaque groupe sur toutes ses parties ; une partie trop proche d'un badge
// déjà posé du même groupe (petits morceaux voisins) n'en reçoit pas un de plus.
function buildBadgesSvg(groups, shownNumbers, bbox, w, h) {
    let svg = "";
    for (const g of groups) {
        const numbers = g.numbers.filter((n) => shownNumbers.has(n)); // pas de badge sans entrée de légende
        if (numbers.length === 0) continue;
        const halfW = Math.max(15, estimateTextWidth(numbers.join(", "), 15, { bold: true }) / 2 + 9);
        const placed = [];
        for (const pt of g.labelPoints) {
            const [px, py] = toPixel(pt, bbox, w, h);
            if (placed.some(([qx, qy]) => Math.abs(px - qx) < 2 * halfW + 4 && Math.abs(py - qy) < 34)) continue;
            placed.push([px, py]);
            svg += buildBadgeSvg(numbers, pt, g.color, bbox, w, h);
        }
    }
    return svg;
}

function buildOverlaySvg(groups, legendLayout, siteContourMerc, bbox, w, h, basemapProviderName) {
    const siteContour = siteContourMerc
        ? geometryToSvg(siteContourMerc, SITE_CONTOUR_COLOR, bbox, w, h, { dashed: true, fillOpacity: 0 })
        : "";
    // Les plus grandes emprises d'abord : une petite opération posée sur une grande reste visible
    const area = ({ extent: e }) => (e.maxX - e.minX) * (e.maxY - e.minY);
    const bySize = [...groups].sort((a, b) => area(b) - area(a));
    const shapes = bySize.map((g) => geometryToSvg(g.geometry, g.color, bbox, w, h)).join("");
    const shownNumbers = new Set(legendLayout.items.map((e) => e.num));
    const badges = buildBadgesSvg(bySize, shownNumbers, bbox, w, h);
    const legend = buildLegendSvg(legendLayout);
    const northArrow = buildNorthArrowSvg(w, h);
    const scaleBar = buildScaleBarSvg(bbox, w, h);
    const credit = buildCreditSvg(basemapProviderName, w, h);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${siteContour}${shapes}${badges}${scaleBar}${northArrow}${credit}${legend}</svg>`;
}

// Doit produire exactement la même clé que operationMatchKey() dans scripts/gen_fiche_travaux.js.
function operationMatchKey(properties) {
    return `${properties.action ?? ''}|${properties.action_2 ?? ''}|${properties.date_debut ?? ''}`;
}

/**
 * Génère l'image (PNG) de la carte de localisation des opérations d'un projet :
 * fond de plan satellite/ORTHO zoomé sur les géométries des opérations, avec ces
 * géométries dessinées par-dessus et le contour du site en repère visuel.
 * Retourne null (jamais ne lève) si aucune carte ne peut être produite, pour que
 * le rapport Word reste généré même en cas d'échec réseau.
 *
 * options.numberByKey (action|action_2|date_debut -> N°) et options.numberByUuid
 * (uuid_ope -> N°) imposent la numérotation des badges/légende, avec la même
 * numérotation que "Opération n°X" dans le corps du document. numberByKey est
 * prioritaire : l'uuid_ope de la géométrie (table localisations) peut diverger de
 * celui de l'opération correspondante dans la liste "lite" selon les données
 * saisies, alors que action/action_2/date_debut identifient l'opération de façon
 * plus fiable. L'appelant n'y met que les clés portées par une seule opération
 * (sinon toutes les opérations de même clé prendraient le même numéro).
 * Une opération sans correspondance reçoit un numéro après le dernier connu.
 */
async function generateOperationsMapImage(operationsFeatureCollection, siteGeoJsonRaw, options = {}) {
    try {
        const allFeatures = (operationsFeatureCollection?.features || [])
            .filter((f) => f?.geometry && GEOM_DEPTH[f.geometry.type] !== undefined);
        const features = allFeatures.filter((f) => isInMetropolitanFrance(f.geometry));
        if (features.length < allFeatures.length) {
            console.warn(`[mapGenerator] ${allFeatures.length - features.length} géométrie(s) d'opération hors de France ignorée(s) (système de coordonnées erroné ?).`);
        }
        if (features.length === 0) {
            console.warn("[mapGenerator] Aucune géométrie d'opération exploitable : carte non générée.");
            return null;
        }

        const aspectRatio = options.aspectRatio || MAP_ASPECT_RATIO;
        const w = options.widthPx || MAP_FETCH_WIDTH_PX;
        const h = Math.round(w / aspectRatio);

        const numberByUuid = options.numberByUuid || {};
        const numberByKey = options.numberByKey || {};
        const known = (p) => numberByKey[operationMatchKey(p)] ?? numberByUuid[p.uuid_ope];
        let nextNumber = Math.max(0, ...Object.values(numberByKey), ...Object.values(numberByUuid));
        const fallbackByUuid = {};
        const numberOf = (f) => known(f.properties) ?? (fallbackByUuid[f.properties.uuid_ope] ??= ++nextNumber);

        // Une entrée de légende par opération (une opération peut avoir plusieurs localisations)
        const entriesByNumber = new Map();
        for (const f of features) {
            const num = numberOf(f);
            if (!entriesByNumber.has(num)) {
                entriesByNumber.set(num, { num, color: couleurOperation(f.properties.action_2), label: legendLabelFor(f.properties) });
            }
        }
        const entries = [...entriesByNumber.values()].sort((a, b) => a.num - b.num);

        const groups = groupByGeometry(features, numberOf);

        const siteGeoJson = typeof siteGeoJsonRaw === "string" ? JSON.parse(siteGeoJsonRaw) : siteGeoJsonRaw;
        const siteContourMerc = siteGeoJson ? projectGeometry(siteGeoJson) : null;

        const legendLayout = layoutLegend(entries, !!siteContourMerc, w, h);
        let bbox = computeMercatorBBox(groups.map((g) => ({ geometry: g.geometry })), { targetAspectRatio: aspectRatio });
        bbox = reserveLegendSpace(bbox, groups, legendLayout, w, h);

        const { buffer: basemapBuffer, providerName } = await fetchBasemapImage(bbox, w, h);

        const overlaySvg = buildOverlaySvg(groups, legendLayout, siteContourMerc, bbox, w, h, providerName);

        return await sharp(basemapBuffer)
            .resize(w, h, { fit: "fill" })
            .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
            .png()
            .toBuffer();
    } catch (err) {
        console.error("[mapGenerator] Échec génération carte des opérations :", err.message);
        return null;
    }
}

module.exports = {
    generateOperationsMapImage,
    MAP_ASPECT_RATIO,
};

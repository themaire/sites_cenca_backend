const sharp = require("sharp");

// Palette réutilisée/étendue par rapport à scripts/gen_fiche_travaux.js (bleuFonce, orange)
const OPERATION_COLORS = ["1a397b", "ff6600", "2e8b57", "8b1a1a", "6a3d9a", "b6d0f7"];
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

function projectFeaturesToMercator(features) {
    return features
        .filter((f) => f?.geometry && GEOM_DEPTH[f.geometry.type] !== undefined)
        .map((f) => ({ properties: f.properties, geometry: projectGeometry(f.geometry) }));
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

// Habillage vecteur (limites + noms de communes), superposé en transparence par-dessus
// le fond satellite pour donner un repère aux personnes qui ne connaissent pas le terrain.
// Best-effort : une indisponibilité ne doit pas empêcher la génération de la carte.
const COMMUNES_OVERLAY = {
    url: "https://data.geopf.fr/wms-v/wms",
    layer: "CADASTRALPARCELS.COMMUNES",
    creditLabel: "Limites communales : IGN Géoportail – BD PARCELLAIRE (data.geopf.fr)",
};

async function fetchCommunesOverlay(bbox, w, h) {
    const url = `${COMMUNES_OVERLAY.url}?` + new URLSearchParams({
        SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap",
        LAYERS: COMMUNES_OVERLAY.layer, STYLES: "", CRS: "EPSG:3857",
        BBOX: `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`,
        WIDTH: String(w), HEIGHT: String(h), FORMAT: "image/png", TRANSPARENT: "true",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WMS_FETCH_TIMEOUT_MS);
    try {
        const resp = await fetch(url, { signal: controller.signal });
        const contentType = resp.headers.get("content-type") || "";
        if (!resp.ok || !contentType.startsWith("image/")) {
            throw new Error(`réponse invalide (status=${resp.status}, content-type=${contentType})`);
        }
        console.log("[mapGenerator] Habillage communes OK");
        return Buffer.from(await resp.arrayBuffer());
    } catch (err) {
        console.warn(`[mapGenerator] Habillage communes indisponible (carte générée sans) : ${err.message}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
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
    const primary = properties.code || properties.titre || properties.date_debut || "";
    const type = String(properties.type || "").split(' / ')[1] || properties.type || "";
    if (primary && type) return `${primary} – ${type}`;
    return primary || type;
}

function computeVisualCentroid(geometry) {
    let sumX = 0, sumY = 0, count = 0;
    forEachPoint(geometry, ([x, y]) => { sumX += x; sumY += y; count += 1; });
    return count > 0 ? [sumX / count, sumY / count] : null;
}

function buildBadgeSvg(index, centroidMerc, color, bbox, w, h) {
    if (!centroidMerc) return "";
    const [px, py] = toPixel(centroidMerc, bbox, w, h);
    return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="15" fill="#${color}" stroke="#ffffff" stroke-width="2.5"/>` +
        `<text x="${px.toFixed(1)}" y="${(py + 5).toFixed(1)}" font-size="15" font-weight="bold" font-family="Calibri, sans-serif" fill="#ffffff" text-anchor="middle">${index}</text>`;
}

// Largeur de caractère moyenne approximative pour Calibri sans-serif, proportionnelle
// à la taille de police (le gras élargit un peu le texte, l'italique très peu).
function estimateTextWidth(text, fontSizePx, { bold = false } = {}) {
    return text.length * fontSizePx * (bold ? 0.62 : 0.55);
}

// Largeur de la boîte calculée à partir du texte réel (titre, sous-titre et lignes,
// bornée à la largeur du canevas) pour ne jamais déborder de l'image.
// rawFeatures doit déjà être trié dans l'ordre de numérotation voulu (cf. numbersByUuid) :
// la légende affiche ses `MAX_LEGEND_ITEMS` premiers éléments dans cet ordre.
function buildLegendSvg(rawFeatures, colorsByUuid, numbersByUuid, hasSiteContour, w, h) {
    const items = rawFeatures.slice(0, MAX_LEGEND_ITEMS);
    const maxLabelChars = 44;
    const labelStartX = 36;
    const padLeft = 10;
    const lineH = 23;
    const titleText = "Légende :";
    const subtitleText = "Localisation des opérations par N° :";
    const siteContourText = "Contour du site";

    const labels = items.map((f) => {
        const num = numbersByUuid[f.properties.uuid_ope];
        const raw = `${num}. ${legendLabelFor(f.properties)}`;
        return raw.length > maxLabelChars ? raw.slice(0, maxLabelChars - 1) + "…" : raw;
    });
    const extra = rawFeatures.length > MAX_LEGEND_ITEMS ? 1 : 0;

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

    let y = y0 + 24;
    let rows = `<text x="${x0 + padLeft}" y="${y}" font-size="16" font-weight="bold" font-family="Calibri, sans-serif" fill="#1a1a1a">${titleText}</text>`;
    if (hasSiteContour) {
        y += lineH;
        rows += `<line x1="${x0 + padLeft}" y1="${y - 5}" x2="${x0 + padLeft + 14}" y2="${y - 5}" stroke="#${SITE_CONTOUR_COLOR}" stroke-width="3" stroke-dasharray="5,3"/>` +
            `<text x="${x0 + labelStartX}" y="${y}" font-size="13.5" font-family="Calibri, sans-serif" fill="#222222">${siteContourText}</text>`;
    }
    y += lineH;
    rows += `<text x="${x0 + padLeft}" y="${y}" font-size="12.5" font-style="italic" font-family="Calibri, sans-serif" fill="#333333">${subtitleText}</text>`;

    items.forEach((f, i) => {
        y += lineH;
        const color = colorsByUuid[f.properties.uuid_ope] || "555555";
        rows += `<rect x="${x0 + padLeft}" y="${y - 12}" width="14" height="14" fill="#${color}"/><text x="${x0 + labelStartX}" y="${y}" font-size="13.5" font-family="Calibri, sans-serif" fill="#222222">${escapeXml(labels[i])}</text>`;
    });
    if (extra) {
        y += lineH;
        rows += `<text x="${x0 + padLeft}" y="${y}" font-size="12" font-style="italic" fill="#666666">+${rawFeatures.length - MAX_LEGEND_ITEMS} autres opérations</text>`;
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
function buildCreditSvg(basemapProviderName, hasCommunesOverlay, w, h) {
    const lines = [`Fond de plan : ${basemapProviderName}`];
    if (hasCommunesOverlay) lines.push(COMMUNES_OVERLAY.creditLabel);

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

// numbersByUuid garantit que les badges sur la carte et les numéros de la légende
// restent alignés même si certaines géométries sont filtrées lors de la projection.
function buildOverlaySvg(rawFeatures, featuresMerc, siteContourMerc, colorsByUuid, numbersByUuid, bbox, w, h, basemapProviderName, hasCommunesOverlay) {
    const siteContour = siteContourMerc
        ? geometryToSvg(siteContourMerc, SITE_CONTOUR_COLOR, bbox, w, h, { dashed: true, fillOpacity: 0 })
        : "";
    const shapes = featuresMerc.map((f) => geometryToSvg(f.geometry, colorsByUuid[f.properties.uuid_ope] || "555555", bbox, w, h)).join("");
    const badges = featuresMerc.map((f) => {
        const number = numbersByUuid[f.properties.uuid_ope];
        if (!number) return ""; // au-delà de MAX_LEGEND_ITEMS, pas de badge sans entrée de légende correspondante
        return buildBadgeSvg(number, computeVisualCentroid(f.geometry), colorsByUuid[f.properties.uuid_ope] || "555555", bbox, w, h);
    }).join("");
    const legend = buildLegendSvg(rawFeatures, colorsByUuid, numbersByUuid, !!siteContourMerc, w, h);
    const northArrow = buildNorthArrowSvg(w, h);
    const scaleBar = buildScaleBarSvg(bbox, w, h);
    const credit = buildCreditSvg(basemapProviderName, hasCommunesOverlay, w, h);
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
 * plus fiable. À défaut de correspondance, l'ordre des features renvoyées par la
 * requête SQL est utilisé (numérotation arbitraire).
 */
async function generateOperationsMapImage(operationsFeatureCollection, siteGeoJsonRaw, options = {}) {
    try {
        const rawFeatures = (operationsFeatureCollection?.features || []).filter((f) => f?.geometry);
        if (rawFeatures.length === 0) {
            console.warn("[mapGenerator] Aucune géométrie d'opération : carte non générée.");
            return null;
        }

        const aspectRatio = options.aspectRatio || MAP_ASPECT_RATIO;
        const w = options.widthPx || MAP_FETCH_WIDTH_PX;
        const h = Math.round(w / aspectRatio);

        const numberByUuid = options.numberByUuid || null;
        const numberByKey = options.numberByKey || null;
        const resolveNumber = (properties) =>
            (numberByKey && numberByKey[operationMatchKey(properties)]) ??
            (numberByUuid && numberByUuid[properties.uuid_ope]) ??
            undefined;

        // Features triées dans l'ordre de numérotation voulu ; celles sans numéro connu
        // (ne devrait pas arriver en pratique) sont reléguées en fin de liste.
        const orderedFeatures = (numberByKey || numberByUuid)
            ? [...rawFeatures].sort((a, b) => (resolveNumber(a.properties) ?? Infinity) - (resolveNumber(b.properties) ?? Infinity))
            : rawFeatures;

        const featuresMerc = projectFeaturesToMercator(orderedFeatures);
        const bbox = computeMercatorBBox(featuresMerc, { targetAspectRatio: aspectRatio });

        const siteGeoJson = typeof siteGeoJsonRaw === "string" ? JSON.parse(siteGeoJsonRaw) : siteGeoJsonRaw;
        const siteContourMerc = siteGeoJson ? projectGeometry(siteGeoJson) : null;

        const [{ buffer: basemapBuffer, providerName }, communesOverlayBuffer] = await Promise.all([
            fetchBasemapImage(bbox, w, h),
            fetchCommunesOverlay(bbox, w, h),
        ]);

        const colorsByUuid = {};
        const numbersByUuid = {};
        orderedFeatures.forEach((f, i) => {
            const uuid = f.properties.uuid_ope;
            const num = resolveNumber(f.properties) ?? (i + 1);
            colorsByUuid[uuid] = OPERATION_COLORS[(num - 1) % OPERATION_COLORS.length];
            if (i < MAX_LEGEND_ITEMS) numbersByUuid[uuid] = num;
        });

        const overlaySvg = buildOverlaySvg(orderedFeatures, featuresMerc, siteContourMerc, colorsByUuid, numbersByUuid, bbox, w, h, providerName, !!communesOverlayBuffer);

        const composites = [];
        if (communesOverlayBuffer) composites.push({ input: communesOverlayBuffer, top: 0, left: 0 });
        composites.push({ input: Buffer.from(overlaySvg), top: 0, left: 0 });

        return await sharp(basemapBuffer)
            .resize(w, h, { fit: "fill" })
            .composite(composites)
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

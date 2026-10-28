const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const helpers = source.slice(
    source.indexOf('        function getPrintPageSize('),
    source.indexOf('        window.captureA3Area =')
);
const context = vm.createContext({});
vm.runInContext(helpers, context);

function near(actual, expected, tolerance = 1e-8) {
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

for (const [paper, shortSide, longSide] of [['A4', 210, 297], ['A3', 297, 420]]) {
    for (const landscape of [false, true]) {
        test(`${paper} ${landscape ? 'landscape' : 'portrait'} physical dimensions`, () => {
            const page = context.getPrintPageSize(paper, landscape);
            assert.equal(page.widthMm, landscape ? longSide : shortSide);
            assert.equal(page.heightMm, landscape ? shortSide : longSide);
            near(page.widthPx / 96 * 25.4, page.widthMm);
            near(page.heightPx / 96 * 25.4, page.heightMm);
        });
    }
}

for (const latitude of [0, 29.5, 32, 33.5, 60]) {
    test(`1:250,000 ground scale at latitude ${latitude}`, () => {
        const zoom = context.getFixedScalePrintZoom(latitude);
        const worldPixels = 256 * 2 ** zoom;
        // Independently measure a centered 20 mm segment using the haversine formula.
        const longitudeSpan = 20 * 96 / 25.4 / worldPixels * 2 * Math.PI;
        const hav = Math.cos(latitude * Math.PI / 180) ** 2 *
            Math.sin(longitudeSpan / 2) ** 2;
        const distance = 2 * 6371000 * Math.asin(Math.sqrt(hav));
        near(distance, 5000, 0.001);
        // Rounding zoom to Leaflet's normal quarter steps would change the scale.
        assert.ok(Math.abs(zoom * 4 - Math.round(zoom * 4)) > 0.001);
    });
}

const preview = source.slice(
    source.indexOf('            function previewSize('),
    source.indexOf('            function resizePrimaryRect(')
);

function previewContext(paperSize, fixedScale, zoom) {
    const state = vm.createContext({
        paperSize, fixedScale, mapW: 1200, mapH: 800,
        appState: { map: { getZoom: () => zoom } }
    });
    vm.runInContext(helpers + preview, state);
    return state;
}

test('fixed-scale preview tracks paper size, orientation, zoom and page latitude', () => {
    const center = { lat: 32 };
    const a4 = previewContext('A4', true, 11).previewSize(center, false);
    const a3 = previewContext('A3', true, 11).previewSize(center, false);
    near(a3.w / a4.w, 297 / 210);
    near(a3.h / a4.h, 420 / 297);
    const landscape = previewContext('A4', true, 11).previewSize(center, true);
    near(landscape.w, a4.h);
    near(landscape.h, a4.w);
    const zoomed = previewContext('A4', true, 12).previewSize(center, false);
    near(zoomed.w, 2 * a4.w);
    near(zoomed.h, 2 * a4.h);
    const north = previewContext('A4', true, 11).previewSize({ lat: 33.5 }, false);
    near(north.w / a4.w, Math.cos(32 * Math.PI / 180) / Math.cos(33.5 * Math.PI / 180));
});

test('legacy fit selection stays viewport-sized when zoom changes', () => {
    const a = previewContext('A4', false, 11).previewSize({ lat: 32 }, false);
    const b = previewContext('A4', false, 12).previewSize({ lat: 32 }, false);
    near(a.w, b.w);
    near(a.h, b.h);
    near(a.h, 800 * 0.8);
});

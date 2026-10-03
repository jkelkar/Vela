import { describe, it, expect } from 'vitest';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { IndicatorModel } from '../src/core/model/indicator';

function model(id: string, paneId: string, ownScale = false, axis?: string): IndicatorModel {
    return {
        id, title: id, overlay: false, paneHint: 'new', paneId, ownScale, axis,
        series: [{ id: `${id}:l`, title: id, paneId, kind: 'line', points: [], style: { color: '#fff', width: 1, lineStyle: 'solid' } }],
        fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {},
    };
}

describe('SceneGraph — per-indicator scale slots', () => {
    it('scaleFor returns the pane scale for a shared indicator and a private scale for a merged one', () => {
        const scene = new SceneGraph();
        const pane = scene.ensurePane('price', 'price', 0, 3);
        pane.scale = { min: 10, max: 20 };

        const shared = model('a', 'price', false);
        const merged = model('b', 'price', true);
        scene.indicators.set('a', shared);
        scene.indicators.set('b', merged);

        // Shared indicator: draws on the pane's master scale.
        expect(scene.scaleFor(shared, pane)).toBe(pane.scale);

        // Merged indicator: gets its own slot, independent of the pane scale.
        const slot = scene.ensureIndicatorScale('b', pane.scaleTarget);
        slot.scale = { min: 0, max: 100 };
        expect(scene.scaleFor(merged, pane)).toEqual({ min: 0, max: 100 });
        expect(scene.scaleFor(merged, pane)).not.toBe(pane.scale);
    });

    it('ownScaleIndicatorsForPane lists only merged indicators (one axis column each), in z order', () => {
        const scene = new SceneGraph();
        scene.ensurePane('p1', 'study', 1, 1);
        scene.indicators.set('shared', model('shared', 'p1', false));
        scene.indicators.set('m1', model('m1', 'p1', true));
        scene.indicators.set('m2', model('m2', 'p1', true));
        scene.setIndicatorZ('m1', 5);
        scene.setIndicatorZ('m2', 2);

        const merged = scene.ownScaleIndicatorsForPane('p1').map((m) => m.id);
        expect(merged).toEqual(['m2', 'm1']); // sorted by ascending z, shared excluded
    });

    it('dropIndicatorScale removes the private slot (merge → unmerge falls back to the pane scale)', () => {
        const scene = new SceneGraph();
        const pane = scene.ensurePane('price', 'price', 0, 3);
        const m = model('b', 'price', true);
        scene.indicators.set('b', m);
        scene.ensureIndicatorScale('b');
        expect(scene.indicatorScales.has('b')).toBe(true);

        scene.dropIndicatorScale('b');
        expect(scene.indicatorScales.has('b')).toBe(false);
        // With no slot, even a still-ownScale model falls back to the pane scale.
        expect(scene.scaleFor(m, pane)).toBe(pane.scale);
    });

    it('orderPanes reassigns order + reflects in orderedPanes (price stays first)', () => {
        const scene = new SceneGraph();
        scene.ensurePane('price', 'price', 0, 3);
        scene.ensurePane('a', 'study', 1, 1);
        scene.ensurePane('b', 'study', 2, 1);

        scene.orderPanes(['price', 'b', 'a']);
        expect(scene.orderedPanes().map((p) => p.id)).toEqual(['price', 'b', 'a']);
    });

    it('a new pane starts uncollapsed', () => {
        const scene = new SceneGraph();
        const pane = scene.ensurePane('a', 'study', 1, 1);
        expect(pane.collapsed).toBe(false);
    });
});

describe('SceneGraph — named axes', () => {
    it('models on the same axis name share one scale group; anonymous own-scale stays one column each', () => {
        const scene = new SceneGraph();
        scene.ensurePane('p1', 'study', 1, 1);
        scene.indicators.set('master', model('master', 'p1'));
        scene.indicators.set('x1', model('x1', 'p1', true, 'xAxis'));
        scene.indicators.set('x2', model('x2', 'p1', true, 'xAxis'));
        scene.indicators.set('anon', model('anon', 'p1', true));

        const groups = scene.ownScaleGroupsForPane('p1');
        expect(groups.map((g) => g.key)).toEqual(['axis:p1:xAxis', 'anon']);
        expect(groups[0]!.models.map((m) => m.id)).toEqual(['x1', 'x2']);
        expect(groups[1]!.models.map((m) => m.id)).toEqual(['anon']);
        // One named axis ⇒ two merged models count as ONE column.
        expect(groups).toHaveLength(2);
    });

    it('the same axis name on another pane is a different scale', () => {
        const scene = new SceneGraph();
        const m1 = model('a', 'p1', true, 'y2');
        const m2 = model('b', 'p2', true, 'y2');
        expect(scene.scaleKeyFor(m1)).not.toBe(scene.scaleKeyFor(m2));
    });

    it('scaleFor returns the shared axis scale for every member of the group', () => {
        const scene = new SceneGraph();
        const pane = scene.ensurePane('p1', 'study', 1, 1);
        pane.scale = { min: 0, max: 1 };
        const m1 = model('a', 'p1', true, 'y2');
        const m2 = model('b', 'p1', true, 'y2');
        scene.indicators.set('a', m1);
        scene.indicators.set('b', m2);

        const slot = scene.ensureIndicatorScale(scene.scaleKeyFor(m1));
        slot.scale = { min: 50, max: 60 };
        expect(scene.scaleFor(m1, pane)).toEqual({ min: 50, max: 60 });
        expect(scene.scaleFor(m2, pane)).toBe(slot.scale); // same object — truly shared
    });

    it('a model with axis but ownScale unset still reads as merged', () => {
        const scene = new SceneGraph();
        scene.ensurePane('p1', 'study', 1, 1);
        scene.indicators.set('a', model('a', 'p1', false, 'y2'));
        expect(scene.ownScaleIndicatorsForPane('p1').map((m) => m.id)).toEqual(['a']);
    });

    it('pruneIndicatorScales drops keys no live group references', () => {
        const scene = new SceneGraph();
        scene.ensurePane('p1', 'study', 1, 1);
        scene.indicators.set('a', model('a', 'p1', true, 'y2'));
        scene.ensureIndicatorScale('axis:p1:y2');
        scene.ensureIndicatorScale('stale');

        const live = new Set(scene.ownScaleGroupsForPane('p1').map((g) => g.key));
        scene.pruneIndicatorScales(live);
        expect(scene.indicatorScales.has('axis:p1:y2')).toBe(true);
        expect(scene.indicatorScales.has('stale')).toBe(false);
    });
});

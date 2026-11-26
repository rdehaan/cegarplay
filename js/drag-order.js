// Ordering a list by dragging (the fragments of the Programs tab, the instances of the Instances
// tab). Each item has a grip (a button): drag it with the mouse, a finger or a pen, and a line shows
// where the item will go; on a focused grip, Arrow Up and Arrow Down move the item one place.
// Pointer events, not HTML5 drag and drop (which works badly on table rows and around editors).
// Only the page uses this module.
//
//   sortable(container, { items, key, onMove, disabled })
//     items(): the elements in their order; key(el): the item's name;
//     onMove(name, beforeName | null): put the item before another (null: at the end);
//     disabled(): no dragging (a run is active).
//   grip(label): a grip button for an item ("Drag to reorder ...").

const EDGE = 48;            // px from the window's edge where the page scrolls while dragging

export function grip(label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'drag-grip';
  b.title = 'Drag to reorder (or Arrow Up / Arrow Down)';
  b.setAttribute('aria-label', label);
  b.textContent = '⠿';
  return b;
}

export function sortable(container, { items, key, onMove, disabled = () => false }) {
  let drag = null;
  const line = document.createElement('div');
  line.className = 'drag-line';
  line.setAttribute('aria-hidden', 'true');

  // where the item would go for the pointer at y: the index of the item it would precede
  function slot(y) {
    const list = items();
    for (let i = 0; i < list.length; i++) {
      const r = list[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return list.length;
  }
  function showLine(i) {
    const list = items();
    const ref = list[Math.min(i, list.length - 1)];
    if (!ref) return;
    const r = ref.getBoundingClientRect(), box = container.getBoundingClientRect();
    const y = i < list.length ? r.top : r.bottom;
    line.style.top = `${y + scrollY - 2}px`;
    line.style.left = `${box.left + scrollX}px`;
    line.style.width = `${box.width}px`;
    if (!line.isConnected) document.body.append(line);
  }
  function finish(apply) {
    if (!drag) return;
    const { el, from, to } = drag;
    cancelAnimationFrame(drag.raf);
    el.classList.remove('dragging');
    document.body.classList.remove('drag-active');
    line.remove();
    drag = null;
    if (!apply || to === null || to === from || to === from + 1) return;
    const list = items();
    const before = to < list.length ? key(list[to]) : null;
    onMove(key(el), before);
  }
  // scroll the page while the pointer is near the top or the bottom of the window
  function autoscroll() {
    if (!drag) return;
    const y = drag.y;
    const top = (document.getElementById('topbar')?.offsetHeight || 0) + EDGE;
    const d = y < top ? -Math.ceil((top - y) / 4) : y > innerHeight - EDGE ? Math.ceil((y - innerHeight + EDGE) / 4) : 0;
    if (d) { scrollBy(0, d); drag.to = slot(y); showLine(drag.to); }
    drag.raf = requestAnimationFrame(autoscroll);
  }

  container.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.drag-grip');
    if (!g || !container.contains(g) || e.button !== 0 || disabled()) return;
    const el = items().find((x) => x.contains(g));
    if (!el) return;
    e.preventDefault();
    g.setPointerCapture(e.pointerId);
    drag = { el, grip: g, from: items().indexOf(el), to: null, y: e.clientY, moved: false, x0: e.clientX, y0: e.clientY, raf: 0 };
  });
  container.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.y = e.clientY;
    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.y0) + Math.abs(e.clientX - drag.x0) < 4) return;
      drag.moved = true;
      drag.el.classList.add('dragging');
      document.body.classList.add('drag-active');
      drag.raf = requestAnimationFrame(autoscroll);
    }
    drag.to = slot(e.clientY);
    showLine(drag.to);
  });
  container.addEventListener('pointerup', () => finish(true));
  container.addEventListener('pointercancel', () => finish(false));
  container.addEventListener('lostpointercapture', () => finish(true));
  addEventListener('keydown', (e) => { if (drag && e.key === 'Escape') finish(false); });

  // the keyboard: Arrow Up / Down on a grip
  container.addEventListener('keydown', (e) => {
    const g = e.target.closest && e.target.closest('.drag-grip');
    if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || disabled()) return;
    const list = items();
    const el = list.find((x) => x.contains(g));
    const i = list.indexOf(el);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowUp' && i > 0) onMove(key(el), key(list[i - 1]));
    else if (e.key === 'ArrowDown' && i < list.length - 1) onMove(key(el), i + 2 < list.length ? key(list[i + 2]) : null);
    else return;
    // the list was drawn again: the focus back on the moved item's grip
    requestAnimationFrame(() => {
      const again = items().find((x) => key(x) === key(el));
      const ng = again && again.querySelector('.drag-grip');
      if (ng) ng.focus();
    });
  });
}

export function createTimeline($, seek) {
  const position = $('position');
  const from = $('range-from');
  const to = $('range-to');
  const loop = $('range-loop');
  const sections = $('markers');
  const remove = $('marker-remove');
  let locked = false;
  const rangeControls = [position, from, to, loop, sections, $('marker-add')];
  let length = 24;
  let cue = 0;
  let markers = [];
  try {
    const stored = JSON.parse(localStorage.getItem('av-sections') || '[]');
    if (Array.isArray(stored)) markers = stored.filter(m => typeof m?.name === 'string' && Number.isInteger(m.from) && Number.isInteger(m.to));
  } catch {}

  function range() {
    const low = Math.max(1, Math.min(length, Math.round(Number(from.value) || 1)));
    const high = Math.max(low, Math.min(length, Math.round(Number(to.value) || length)));
    return { from: low - 1, to: high };
  }

  function showMarkers() {
    sections.replaceChildren(new Option('Sections', ''));
    remove.disabled = true;
    markers.forEach((marker, index) => {
      if (marker.from >= 0 && marker.to > marker.from && marker.to <= length) {
        sections.add(new Option(marker.name + ' · ' + (marker.from + 1) + '–' + marker.to, String(index)));
      }
    });
  }

  function update(clock) {
    const cycle = clock ? Math.floor(clock.beat) : cue;
    if (document.activeElement !== position) position.value = cycle + 1;
    $('cycle-label').value = 'Cycle ' + (cycle + 1) + ' / ' + length;
    const selection = range();
    position.style.setProperty('--range-from', 100 * selection.from / length + '%');
    position.style.setProperty('--range-to', 100 * selection.to / length + '%');
  }

  function go(cycle) {
    if (loop.checked) {
      const { from: low, to: high } = range();
      cycle = Math.max(low, Math.min(high - 1, cycle));
    }
    cue = cycle;
    position.value = cycle + 1;
    update(null);
    seek(cycle);
  }

  position.oninput = () => go(Number(position.value) - 1);
  from.onchange = to.onchange = () => {
    const selection = range();
    from.value = selection.from + 1;
    to.value = selection.to;
    if (loop.checked) go(selection.from);
    else update(null);
  };
  loop.onchange = () => go(loop.checked ? range().from : Number(position.value) - 1);
  $('marker-add').onclick = () => {
    const name = window.prompt('Section name')?.trim();
    if (!name) return;
    markers.push({ name, ...range() });
    saveMarkers();
    showMarkers();
  };
  function saveMarkers() {
    try { localStorage.setItem('av-sections', JSON.stringify(markers)); } catch {}
  }

  remove.onclick = () => {
    if (sections.value === '') return;
    markers.splice(Number(sections.value), 1);
    saveMarkers();
    showMarkers();
  };
  sections.onchange = () => {
    remove.disabled = locked || sections.value === '';
    if (sections.value === '') return;
    const marker = markers[Number(sections.value)];
    from.value = marker.from + 1;
    to.value = marker.to;
    go(marker.from);
  };
  showMarkers();
  return {
    range, update,
    cue: () => cue,
    repeat: () => loop.checked ? range() : null,
    disable(disabled) {
      locked = disabled;
      rangeControls.forEach(control => { control.disabled = disabled; });
      remove.disabled = disabled || sections.value === '';
    },
    setLength(next) {
      if (length === next) return;
      if (Number(to.value) === length) to.value = next;
      length = next;
      for (const input of [position, from, to]) input.max = next;
      const selection = range();
      from.value = selection.from + 1;
      to.value = selection.to;
      cue = Math.min(cue, next - 1);
      showMarkers();
      update(null);
    },
  };
}

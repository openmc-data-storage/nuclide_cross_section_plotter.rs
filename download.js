// Downloading what is drawn, as JSON or CSV.
//
// One object (or one block of rows) per series, each carrying its own units
// and provenance, rather than parallel arrays: a file that names the library
// and temperature of every column is one that can be read a year later.

/// `series`: array of {nuclide, library, particle, mt, reaction, temperature,
/// units, energy, xs} where energy and xs are typed arrays.
export function seriesToJson(series) {
  const out = series.map((s) => ({
    nuclide: s.nuclide,
    library: s.library,
    particle: s.particle,
    mt: s.mt,
    reaction: s.reaction,
    temperature_K: s.temperature ? Number(s.temperature.replace(/K$/, '')) : null,
    units: s.units,
    energy_eV: Array.from(s.energy),
    xs: Array.from(s.xs),
  }));
  return JSON.stringify(out, null, 1);
}

/// Long-form CSV: one row per point, with the series columns repeated.
export function seriesToCsv(series) {
  const lines = ['nuclide,library,particle,mt,reaction,temperature_K,units,energy_eV,xs'];
  for (const s of series) {
    const t = s.temperature ? s.temperature.replace(/K$/, '') : '';
    const head = `${s.nuclide},${s.library},${s.particle},${s.mt},"${s.reaction}",${t},${s.units},`;
    for (let i = 0; i < s.energy.length; i++) lines.push(`${head}${s.energy[i]},${s.xs[i]}`);
  }
  return lines.join('\n') + '\n';
}

/// Save text as a file through a temporary link (browser only).
export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

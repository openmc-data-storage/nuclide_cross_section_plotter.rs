// Building the Plotly figure from the drawn series.
//
// Colour follows the series, not its position: each series keeps the slot it
// was given when first drawn until the plot is cleared, so ticking or unticking
// a neighbour never repaints the rest. Eight hues are used in fixed order; the
// ninth series onward reuses them with a different dash, so colour and line
// style together stay distinct, and the legend is always shown.
//
// Cross sections are in barn. Heating and damage energy (ENDF MT 301 to 450,
// and 901) are energy releases in eV·barn and cannot share an axis with them:
// alone they take the left axis with their own title; together with cross
// sections they move to a right-hand axis, the same treatment the materials
// plotter gives them.

/// The dark-surface categorical palette, in the order slots are handed out.
export const PALETTE = Object.freeze([
  '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767',
]);
const DASHES = ['solid', 'dash', 'dot', 'dashdot'];
const SURFACE = '#1a1a19';
const GRID = '#33332f';
const INK = '#ffffff';
const INK_SECONDARY = '#c3c2b7';

/// Colour and dash for the n-th series drawn.
export function styleFor(slot) {
  return { color: PALETTE[slot % PALETTE.length], dash: DASHES[Math.floor(slot / PALETTE.length) % DASHES.length] };
}

/// True for an MT whose values are an energy release in eV·barn.
export function isEnergyRelease(mt) {
  mt = Number(mt);
  return (mt >= 301 && mt <= 450) || mt === 901;
}

/// Axis title for a set of energy-release MTs.
export function energyReleaseTitle(mts) {
  const kinds = new Set(mts.map((mt) => (Number(mt) === 444 ? 'Damage energy' : 'Heating')));
  const label = kinds.size === 1 ? [...kinds][0] : 'Heating and damage energy';
  return `${label} (eV·barn)`;
}

const axisBase = (log) => ({
  type: log ? 'log' : 'linear',
  gridcolor: GRID,
  zerolinecolor: GRID,
  linecolor: GRID,
  tickcolor: INK_SECONDARY,
  tickfont: { color: INK_SECONDARY },
  title: { font: { color: INK } },
  exponentformat: 'power',
});

/// `series`: array of {name, energy, xs, mt, slot}. Returns {data, layout, config}.
export function buildFigure(series, { xLog = true, yLog = true } = {}) {
  const release = series.filter((s) => isEnergyRelease(s.mt));
  const mixed = release.length > 0 && release.length < series.length;
  const data = series.map((s) => {
    const { color, dash } = styleFor(s.slot);
    const unit = isEnergyRelease(s.mt) ? 'eV·barn' : 'barn';
    return {
      type: 'scattergl',
      mode: 'lines',
      name: s.name,
      x: s.energy,
      y: s.xs,
      line: { color, dash, width: 2 },
      yaxis: mixed && isEnergyRelease(s.mt) ? 'y2' : 'y',
      hovertemplate: `%{y:.4g} ${unit}<extra>${s.name}</extra>`,
    };
  });

  const layout = {
    paper_bgcolor: SURFACE,
    plot_bgcolor: SURFACE,
    font: { color: INK_SECONDARY, size: 13 },
    margin: { l: 80, r: mixed ? 80 : 30, t: 20, b: 60 },
    xaxis: {
      ...axisBase(xLog),
      title: { text: 'Energy (eV)', font: { color: INK } },
      showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: INK_SECONDARY, spikedash: 'dot',
    },
    yaxis: { ...axisBase(yLog) },
    legend: { orientation: 'h', y: -0.16, yanchor: 'top', font: { color: INK } },
    hovermode: 'x unified',
    hoverlabel: { bgcolor: '#26262a', bordercolor: GRID, font: { color: INK } },
    uirevision: 'keep',
  };
  if (series.length && release.length === series.length) {
    layout.yaxis.title.text = energyReleaseTitle(release.map((s) => s.mt));
  } else {
    layout.yaxis.title.text = 'Microscopic cross section (barn)';
    if (mixed) {
      layout.yaxis2 = {
        ...axisBase(yLog),
        title: { text: energyReleaseTitle(release.map((s) => s.mt)), font: { color: INK } },
        overlaying: 'y', side: 'right', showgrid: false,
      };
    }
  }
  const config = { responsive: true, displaylogo: false, scrollZoom: true, modeBarButtonsToRemove: ['select2d', 'lasso2d'] };
  return { data, layout, config };
}
